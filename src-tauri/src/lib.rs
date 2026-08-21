use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: usize,
    line_number: usize,
    timestamp: String,
    level: String,
    scope: String,
    message: String,
    raw: String,
    parse_error: Option<String>,
    context_only: bool,
    #[serde(skip_serializing)]
    timestamp_ms: Option<i64>,
}

struct LogStore {
    path: Option<PathBuf>,
    entries: Vec<Entry>,
    position: u64,
    partial: Vec<u8>,
    next_line_number: usize,
    fields: FieldConfig,
    query_cache: Option<QueryCache>,
}

struct QueryCache {
    key: QueryKey,
    entry_count: usize,
    direct_matches: Vec<usize>,
    visible_matches: Vec<usize>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldConfig {
    time_fields: Vec<String>,
    level_fields: Vec<String>,
    scope_fields: Vec<String>,
    message_fields: Vec<String>,
}

impl Default for FieldConfig {
    fn default() -> Self {
        Self {
            time_fields: vec!["timestamp", "time", "ts", "@timestamp"]
                .into_iter()
                .map(String::from)
                .collect(),
            level_fields: vec!["level", "severity", "logLevel"]
                .into_iter()
                .map(String::from)
                .collect(),
            scope_fields: vec!["scope", "namespace", "module", "logger"]
                .into_iter()
                .map(String::from)
                .collect(),
            message_fields: vec!["message", "msg", "event", "name"]
                .into_iter()
                .map(String::from)
                .collect(),
        }
    }
}

impl Default for LogStore {
    fn default() -> Self {
        Self {
            path: None,
            entries: vec![],
            position: 0,
            partial: vec![],
            next_line_number: 1,
            fields: FieldConfig::default(),
            query_cache: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    path: String,
    name: String,
    size: u64,
    total: usize,
    invalid_json: usize,
    levels: Vec<String>,
    scopes: Vec<String>,
}

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FieldFilter {
    path: String,
    operator: String,
    value: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    text: String,
    regex: bool,
    case_sensitive: bool,
    levels: Vec<String>,
    scopes: Vec<String>,
    #[serde(default)]
    field_filters: Vec<FieldFilter>,
    #[serde(default)]
    time_start_ms: Option<i64>,
    #[serde(default)]
    time_end_ms: Option<i64>,
    #[serde(default)]
    context: usize,
    #[serde(default)]
    invalid_only: bool,
    offset: usize,
    limit: usize,
}

#[derive(Clone, PartialEq, Eq)]
struct QueryKey {
    text: String,
    regex: bool,
    case_sensitive: bool,
    levels: Vec<String>,
    scopes: Vec<String>,
    field_filters: Vec<FieldFilter>,
    time_start_ms: Option<i64>,
    time_end_ms: Option<i64>,
    context: usize,
    invalid_only: bool,
}

impl From<&Query> for QueryKey {
    fn from(query: &Query) -> Self {
        Self {
            text: query.text.clone(),
            regex: query.regex,
            case_sensitive: query.case_sensitive,
            levels: query.levels.clone(),
            scopes: query.scopes.clone(),
            field_filters: query.field_filters.clone(),
            time_start_ms: query.time_start_ms,
            time_end_ms: query.time_end_ms,
            context: query.context,
            invalid_only: query.invalid_only,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResult {
    items: Vec<Entry>,
    matched: usize,
    direct_matched: usize,
    total: usize,
    elapsed_ms: u128,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    version: String,
    notes: Option<String>,
}

fn value_at_path<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).or_else(|| {
        key.split('.')
            .try_fold(value, |current, part| current.get(part))
    })
}

fn string_field(value: &Value, keys: &[String]) -> String {
    keys.iter()
        .find_map(|key| value_at_path(value, key))
        .map(|v| match v {
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        })
        .unwrap_or_default()
}

fn parse_timestamp_ms(input: &str) -> Option<i64> {
    let value = input.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(number) = value.parse::<f64>() {
        let absolute = number.abs();
        let milliseconds = if absolute < 100_000_000_000.0 {
            number * 1_000.0
        } else if absolute < 100_000_000_000_000.0 {
            number
        } else if absolute < 100_000_000_000_000_000.0 {
            number / 1_000.0
        } else {
            number / 1_000_000.0
        };
        if milliseconds.is_finite() {
            return Some(milliseconds.round() as i64);
        }
    }
    if let Ok(date) = DateTime::parse_from_rfc3339(value) {
        return Some(date.timestamp_millis());
    }
    for format in ["%d/%b/%Y:%H:%M:%S%.f %z", "%d/%b/%Y:%H:%M:%S %z"] {
        if let Ok(date) = DateTime::parse_from_str(value, format) {
            return Some(date.timestamp_millis());
        }
    }
    for format in [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y/%m/%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
    ] {
        if let Ok(date) = NaiveDateTime::parse_from_str(value, format) {
            if let Some(local) = Local.from_local_datetime(&date).single() {
                return Some(local.timestamp_millis());
            }
        }
    }
    None
}

fn parse_entry(id: usize, line_number: usize, bytes: &[u8], fields: &FieldConfig) -> Option<Entry> {
    let raw = String::from_utf8_lossy(bytes)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    if raw.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(value) => {
            let timestamp = string_field(&value, &fields.time_fields);
            let mut level = string_field(&value, &fields.level_fields).to_uppercase();
            if level.is_empty() {
                level = "OTHER".into();
            }
            let scope = string_field(&value, &fields.scope_fields);
            let mut message = string_field(&value, &fields.message_fields);
            if message.is_empty() {
                message = raw.clone();
            }
            let timestamp_ms = parse_timestamp_ms(&timestamp);
            Some(Entry {
                id,
                line_number,
                timestamp,
                level,
                scope,
                message,
                raw,
                parse_error: None,
                context_only: false,
                timestamp_ms,
            })
        }
        Err(error) => Some(Entry {
            id,
            line_number,
            timestamp: String::new(),
            level: "INVALID".into(),
            scope: String::new(),
            message: raw.clone(),
            raw,
            parse_error: Some(error.to_string()),
            context_only: false,
            timestamp_ms: None,
        }),
    }
}

fn field_filter_matches(value: &Value, filter: &FieldFilter) -> bool {
    let found = value_at_path(value, filter.path.trim());
    match filter.operator.as_str() {
        "exists" => return found.is_some(),
        "notExists" => return found.is_none(),
        _ => {}
    }
    let Some(actual) = found else {
        return false;
    };
    let actual_text = actual
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| actual.to_string());
    match filter.operator.as_str() {
        "equals" | "notEquals" => {
            let equals = serde_json::from_str::<Value>(&filter.value).map_or_else(
                |_| actual_text == filter.value,
                |expected| actual == &expected,
            );
            if filter.operator == "equals" {
                equals
            } else {
                !equals
            }
        }
        "contains" => actual_text.contains(&filter.value),
        "notContains" => !actual_text.contains(&filter.value),
        "greater" | "greaterOrEqual" | "less" | "lessOrEqual" => {
            let Some(left) = actual.as_f64().or_else(|| actual_text.parse().ok()) else {
                return false;
            };
            let Some(right) = filter.value.parse::<f64>().ok() else {
                return false;
            };
            match filter.operator.as_str() {
                "greater" => left > right,
                "greaterOrEqual" => left >= right,
                "less" => left < right,
                _ => left <= right,
            }
        }
        _ => false,
    }
}

fn matching_indices(entries: &[Entry], query: &Query) -> Result<Vec<usize>, String> {
    let pattern: Option<Regex> = if query.regex && !query.text.is_empty() {
        Some(
            RegexBuilder::new(&query.text)
                .case_insensitive(!query.case_sensitive)
                .build()
                .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };
    let needle = if query.case_sensitive {
        query.text.clone()
    } else {
        query.text.to_lowercase()
    };
    Ok(entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            if query.invalid_only && entry.parse_error.is_none() {
                return None;
            }
            if !query.levels.is_empty() && !query.levels.contains(&entry.level) {
                return None;
            }
            if !query.scopes.is_empty() && !query.scopes.contains(&entry.scope) {
                return None;
            }
            if query
                .time_start_ms
                .is_some_and(|start| entry.timestamp_ms.is_none_or(|value| value < start))
            {
                return None;
            }
            if query
                .time_end_ms
                .is_some_and(|end| entry.timestamp_ms.is_none_or(|value| value > end))
            {
                return None;
            }
            if !query.field_filters.is_empty() {
                let Ok(value) = serde_json::from_str::<Value>(&entry.raw) else {
                    return None;
                };
                if !query
                    .field_filters
                    .iter()
                    .all(|filter| field_filter_matches(&value, filter))
                {
                    return None;
                }
            }
            let text_ok = if needle.is_empty() {
                true
            } else if let Some(regex) = &pattern {
                regex.is_match(&entry.raw)
            } else if query.case_sensitive {
                entry.raw.contains(&needle)
            } else {
                entry.raw.to_lowercase().contains(&needle)
            };
            text_ok.then_some(index)
        })
        .collect())
}

fn visible_indices(direct: &[usize], context: usize, entry_count: usize) -> Vec<usize> {
    if context == 0 {
        return direct.to_vec();
    }
    let mut visible = BTreeSet::new();
    for index in direct {
        let start = index.saturating_sub(context);
        let end = index
            .saturating_add(context)
            .min(entry_count.saturating_sub(1));
        visible.extend(start..=end);
    }
    visible.into_iter().collect()
}

fn append_new(store: &mut LogStore) -> Result<usize, String> {
    let path = store.path.clone().ok_or("No file is open")?;
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len < store.position {
        store.entries.clear();
        store.position = 0;
        store.partial.clear();
        store.next_line_number = 1;
        store.query_cache = None;
    }
    if len == store.position {
        return Ok(0);
    }
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(store.position))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut chunk = Vec::new();
    let before = store.entries.len();
    loop {
        chunk.clear();
        let read = reader
            .read_until(b'\n', &mut chunk)
            .map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        store.position += read as u64;
        if !store.partial.is_empty() {
            store.partial.extend_from_slice(&chunk);
            chunk = std::mem::take(&mut store.partial);
        }
        if !chunk.ends_with(b"\n") {
            store.partial = chunk.clone();
            break;
        }
        let line_number = store.next_line_number;
        store.next_line_number += 1;
        if let Some(entry) = parse_entry(store.entries.len(), line_number, &chunk, &store.fields) {
            store.entries.push(entry);
        }
    }
    let appended = store.entries.len() - before;
    if appended > 0 {
        store.query_cache = None;
    }
    Ok(appended)
}

fn info(store: &LogStore) -> Result<FileInfo, String> {
    let path = store.path.as_ref().ok_or("No file is open")?;
    let mut levels: Vec<_> = store.entries.iter().map(|e| e.level.clone()).collect();
    levels.sort();
    levels.dedup();
    let mut scopes: Vec<_> = store
        .entries
        .iter()
        .filter(|e| !e.scope.is_empty())
        .map(|e| e.scope.clone())
        .collect();
    scopes.sort();
    scopes.dedup();
    scopes.truncate(100);
    let invalid_json = store
        .entries
        .iter()
        .filter(|entry| entry.parse_error.is_some())
        .count();
    Ok(FileInfo {
        path: path.display().to_string(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        size: fs::metadata(path).map_err(|e| e.to_string())?.len(),
        total: store.entries.len(),
        invalid_json,
        levels,
        scopes,
    })
}

#[tauri::command]
fn open_log(path: String, state: tauri::State<Mutex<LogStore>>) -> Result<FileInfo, String> {
    let started = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let fields = store.fields.clone();
    *store = LogStore {
        path: Some(PathBuf::from(path)),
        fields,
        ..Default::default()
    };
    append_new(&mut store)?;
    let result = info(&store)?;
    eprintln!("indexed {} lines in {:?}", result.total, started.elapsed());
    Ok(result)
}

#[tauri::command]
fn refresh_log(state: tauri::State<Mutex<LogStore>>) -> Result<FileInfo, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    append_new(&mut store)?;
    info(&store)
}

#[tauri::command]
fn set_field_config(
    config: FieldConfig,
    state: tauri::State<Mutex<LogStore>>,
) -> Result<Option<FileInfo>, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.fields = config;
    if store.path.is_none() {
        return Ok(None);
    }
    store.entries.clear();
    store.position = 0;
    store.partial.clear();
    store.next_line_number = 1;
    store.query_cache = None;
    append_new(&mut store)?;
    info(&store).map(Some)
}

#[tauri::command]
fn query_logs(query: Query, state: tauri::State<Mutex<LogStore>>) -> Result<QueryResult, String> {
    let started = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let key = QueryKey::from(&query);
    let cache_valid = store
        .query_cache
        .as_ref()
        .is_some_and(|cache| cache.key == key && cache.entry_count == store.entries.len());
    if !cache_valid {
        let direct_matches = match matching_indices(&store.entries, &query) {
            Ok(matches) => matches,
            Err(error) => {
                return Ok(QueryResult {
                    items: vec![],
                    matched: 0,
                    direct_matched: 0,
                    total: store.entries.len(),
                    elapsed_ms: started.elapsed().as_millis(),
                    error: Some(error),
                })
            }
        };
        let visible_matches = visible_indices(&direct_matches, query.context, store.entries.len());
        store.query_cache = Some(QueryCache {
            key,
            entry_count: store.entries.len(),
            direct_matches,
            visible_matches,
        });
    }
    let cache = store.query_cache.as_ref().expect("query cache initialized");
    let matched = cache.visible_matches.len();
    let direct_matched = cache.direct_matches.len();
    let items = cache
        .visible_matches
        .iter()
        .skip(query.offset)
        .take(query.limit)
        .map(|index| {
            let mut entry = store.entries[*index].clone();
            entry.context_only = cache.direct_matches.binary_search(index).is_err();
            entry
        })
        .collect();
    Ok(QueryResult {
        items,
        matched,
        direct_matched,
        total: store.entries.len(),
        elapsed_ms: started.elapsed().as_millis(),
        error: None,
    })
}

fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn write_export(
    query: Query,
    path: String,
    format: String,
    store: &LogStore,
) -> Result<usize, String> {
    let indices = matching_indices(&store.entries, &query)?;
    let file = File::create(path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    if format.eq_ignore_ascii_case("csv") {
        writeln!(writer, "line,timestamp,level,scope,message,parse_error,raw")
            .map_err(|error| error.to_string())?;
        for index in &indices {
            let entry = &store.entries[*index];
            writeln!(
                writer,
                "{},{},{},{},{},{},{}",
                entry.line_number,
                csv_cell(&entry.timestamp),
                csv_cell(&entry.level),
                csv_cell(&entry.scope),
                csv_cell(&entry.message),
                csv_cell(entry.parse_error.as_deref().unwrap_or("")),
                csv_cell(&entry.raw),
            )
            .map_err(|error| error.to_string())?;
        }
    } else {
        for index in &indices {
            writeln!(writer, "{}", store.entries[*index].raw).map_err(|error| error.to_string())?;
        }
    }
    writer.flush().map_err(|error| error.to_string())?;
    Ok(indices.len())
}

#[tauri::command]
async fn export_logs(
    query: Query,
    path: String,
    format: String,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<LogStore>>();
        let store = state.lock().map_err(|error| error.to_string())?;
        write_export(query, path, format, &store)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|update| UpdateInfo {
        current_version: update.current_version,
        version: update.version,
        notes: update.body,
    }))
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update is available".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(LogStore::default()))
        .invoke_handler(tauri::generate_handler![
            open_log,
            refresh_log,
            query_logs,
            export_logs,
            set_field_config,
            check_for_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tracebeam");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_query() -> Query {
        Query {
            text: String::new(),
            regex: false,
            case_sensitive: false,
            levels: vec![],
            scopes: vec![],
            field_filters: vec![],
            time_start_ms: None,
            time_end_ms: None,
            context: 0,
            invalid_only: false,
            offset: 0,
            limit: 250,
        }
    }

    #[test]
    fn default_mapping_recognizes_timestamp() {
        let entry = parse_entry(
            0,
            1,
            br#"{"timestamp":"2026-08-03T10:00:00Z","level":"info","message":"ready"}
"#,
            &FieldConfig::default(),
        )
        .unwrap();
        assert_eq!(entry.timestamp, "2026-08-03T10:00:00Z");
        assert_eq!(entry.level, "INFO");
        assert!(entry.timestamp_ms.is_some());
    }

    #[test]
    fn custom_mapping_supports_nested_paths() {
        let fields = FieldConfig {
            time_fields: vec!["meta.created_at".into()],
            level_fields: vec!["meta.kind".into()],
            scope_fields: vec!["context.area".into()],
            message_fields: vec!["payload.text".into()],
        };
        let entry = parse_entry(0, 7, br#"{"meta":{"created_at":42,"kind":"warn"},"context":{"area":"api"},"payload":{"text":"slow"}}
"#, &fields).unwrap();
        assert_eq!(entry.timestamp, "42");
        assert_eq!(entry.level, "WARN");
        assert_eq!(entry.scope, "api");
        assert_eq!(entry.message, "slow");
        assert_eq!(entry.line_number, 7);
    }

    #[test]
    fn invalid_json_is_preserved_with_diagnostics() {
        let entry = parse_entry(0, 3, b"{broken}\n", &FieldConfig::default()).unwrap();
        assert_eq!(entry.level, "INVALID");
        assert_eq!(entry.raw, "{broken}");
        assert!(entry.parse_error.is_some());
    }

    #[test]
    fn structured_filters_compare_nested_and_numeric_values() {
        let entries = vec![
            parse_entry(
                0,
                1,
                br#"{"meta":{"status":200},"durationMs":80}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
            parse_entry(
                1,
                2,
                br#"{"meta":{"status":503},"durationMs":420}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
        ];
        let query = Query {
            field_filters: vec![
                FieldFilter {
                    path: "meta.status".into(),
                    operator: "greaterOrEqual".into(),
                    value: "500".into(),
                },
                FieldFilter {
                    path: "durationMs".into(),
                    operator: "greater".into(),
                    value: "100".into(),
                },
            ],
            ..base_query()
        };
        assert_eq!(matching_indices(&entries, &query).unwrap(), vec![1]);
        assert_eq!(visible_indices(&[1], 1, entries.len()), vec![0, 1]);
    }

    #[test]
    fn time_and_invalid_filters_exclude_unparseable_timestamps() {
        let entries = vec![
            parse_entry(
                0,
                1,
                br#"{"timestamp":"2026-08-03T10:00:00Z"}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
            parse_entry(1, 2, br#"{"timestamp":"unknown"}"#, &FieldConfig::default()).unwrap(),
            parse_entry(2, 3, b"{broken}", &FieldConfig::default()).unwrap(),
        ];
        let start = parse_timestamp_ms("2026-08-03T09:59:00Z").unwrap();
        let end = parse_timestamp_ms("2026-08-03T10:01:00Z").unwrap();
        assert_eq!(
            matching_indices(
                &entries,
                &Query {
                    time_start_ms: Some(start),
                    time_end_ms: Some(end),
                    ..base_query()
                }
            )
            .unwrap(),
            vec![0]
        );
        assert_eq!(
            matching_indices(
                &entries,
                &Query {
                    invalid_only: true,
                    ..base_query()
                }
            )
            .unwrap(),
            vec![2]
        );
    }

    #[test]
    fn export_writes_every_direct_match_without_context_rows() {
        let entries = vec![
            parse_entry(
                0,
                1,
                br#"{"level":"info","message":"before"}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
            parse_entry(
                1,
                2,
                br#"{"level":"error","message":"failed"}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
            parse_entry(
                2,
                3,
                br#"{"level":"info","message":"after"}"#,
                &FieldConfig::default(),
            )
            .unwrap(),
        ];
        let store = LogStore {
            entries,
            ..Default::default()
        };
        let path =
            std::env::temp_dir().join(format!("tracebeam-export-{}.jsonl", std::process::id()));
        let count = write_export(
            Query {
                levels: vec!["ERROR".into()],
                context: 1,
                ..base_query()
            },
            path.display().to_string(),
            "jsonl".into(),
            &store,
        )
        .unwrap();
        let output = fs::read_to_string(&path).unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(count, 1);
        assert!(output.contains("failed"));
        assert!(!output.contains("before"));
        assert!(!output.contains("after"));
    }
}
