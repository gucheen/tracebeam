use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs::{self, File}, io::{BufRead, BufReader, Seek, SeekFrom}, path::PathBuf, sync::Mutex};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: usize,
    timestamp: String,
    level: String,
    scope: String,
    message: String,
    raw: String,
}

struct LogStore {
    path: Option<PathBuf>,
    entries: Vec<Entry>,
    position: u64,
    partial: Vec<u8>,
    fields: FieldConfig,
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
            time_fields: vec!["timestamp", "time", "ts", "@timestamp"].into_iter().map(String::from).collect(),
            level_fields: vec!["level", "severity", "logLevel"].into_iter().map(String::from).collect(),
            scope_fields: vec!["scope", "namespace", "module", "logger"].into_iter().map(String::from).collect(),
            message_fields: vec!["message", "msg", "event", "name"].into_iter().map(String::from).collect(),
        }
    }
}

impl Default for LogStore {
    fn default() -> Self {
        Self { path: None, entries: vec![], position: 0, partial: vec![], fields: FieldConfig::default() }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo { path: String, name: String, size: u64, total: usize, levels: Vec<String>, scopes: Vec<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query { text: String, regex: bool, case_sensitive: bool, levels: Vec<String>, scopes: Vec<String>, offset: usize, limit: usize }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResult { items: Vec<Entry>, matched: usize, total: usize, elapsed_ms: u128, error: Option<String> }

fn value_at_path<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).or_else(|| key.split('.').try_fold(value, |current, part| current.get(part)))
}

fn string_field(value: &Value, keys: &[String]) -> String {
    keys.iter().find_map(|key| value_at_path(value, key)).map(|v| match v { Value::String(s) => s.clone(), _ => v.to_string() }).unwrap_or_default()
}

fn parse_entry(id: usize, bytes: &[u8], fields: &FieldConfig) -> Option<Entry> {
    let raw = String::from_utf8_lossy(bytes).trim_end_matches(['\r', '\n']).to_string();
    if raw.is_empty() { return None; }
    let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let timestamp = string_field(&value, &fields.time_fields);
    let mut level = string_field(&value, &fields.level_fields).to_uppercase();
    if level.is_empty() { level = "OTHER".into(); }
    let scope = string_field(&value, &fields.scope_fields);
    let mut message = string_field(&value, &fields.message_fields);
    if message.is_empty() { message = raw.clone(); }
    Some(Entry { id, timestamp, level, scope, message, raw })
}

fn append_new(store: &mut LogStore) -> Result<usize, String> {
    let path = store.path.clone().ok_or("No file is open")?;
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len < store.position {
        store.entries.clear(); store.position = 0; store.partial.clear();
    }
    if len == store.position { return Ok(0); }
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(store.position)).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut chunk = Vec::new();
    let before = store.entries.len();
    loop {
        chunk.clear();
        let read = reader.read_until(b'\n', &mut chunk).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        store.position += read as u64;
        if !store.partial.is_empty() { store.partial.extend_from_slice(&chunk); chunk = std::mem::take(&mut store.partial); }
        if !chunk.ends_with(b"\n") {
            store.partial = chunk.clone();
            break;
        }
        if let Some(entry) = parse_entry(store.entries.len(), &chunk, &store.fields) { store.entries.push(entry); }
    }
    Ok(store.entries.len() - before)
}

fn info(store: &LogStore) -> Result<FileInfo, String> {
    let path = store.path.as_ref().ok_or("No file is open")?;
    let mut levels: Vec<_> = store.entries.iter().map(|e| e.level.clone()).collect();
    levels.sort(); levels.dedup();
    let mut scopes: Vec<_> = store.entries.iter().filter(|e| !e.scope.is_empty()).map(|e| e.scope.clone()).collect();
    scopes.sort(); scopes.dedup(); scopes.truncate(100);
    Ok(FileInfo { path: path.display().to_string(), name: path.file_name().unwrap_or_default().to_string_lossy().into(), size: fs::metadata(path).map_err(|e| e.to_string())?.len(), total: store.entries.len(), levels, scopes })
}

#[tauri::command]
fn open_log(path: String, state: tauri::State<Mutex<LogStore>>) -> Result<FileInfo, String> {
    let started = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let fields = store.fields.clone();
    *store = LogStore { path: Some(PathBuf::from(path)), fields, ..Default::default() };
    append_new(&mut store)?;
    let result = info(&store)?;
    eprintln!("indexed {} lines in {:?}", result.total, started.elapsed());
    Ok(result)
}

#[tauri::command]
fn refresh_log(state: tauri::State<Mutex<LogStore>>) -> Result<FileInfo, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    append_new(&mut store)?; info(&store)
}

#[tauri::command]
fn set_field_config(config: FieldConfig, state: tauri::State<Mutex<LogStore>>) -> Result<Option<FileInfo>, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.fields = config;
    if store.path.is_none() { return Ok(None); }
    store.entries.clear(); store.position = 0; store.partial.clear();
    append_new(&mut store)?;
    info(&store).map(Some)
}

#[tauri::command]
fn query_logs(query: Query, state: tauri::State<Mutex<LogStore>>) -> Result<QueryResult, String> {
    let started = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    let pattern: Option<Regex> = if query.regex && !query.text.is_empty() {
        match RegexBuilder::new(&query.text).case_insensitive(!query.case_sensitive).build() {
            Ok(r) => Some(r), Err(e) => return Ok(QueryResult { items: vec![], matched: 0, total: store.entries.len(), elapsed_ms: started.elapsed().as_millis(), error: Some(e.to_string()) })
        }
    } else { None };
    let needle = if query.case_sensitive { query.text.clone() } else { query.text.to_lowercase() };
    let mut matched = 0; let mut items = Vec::with_capacity(query.limit);
    for entry in &store.entries {
        if !query.levels.is_empty() && !query.levels.contains(&entry.level) { continue; }
        if !query.scopes.is_empty() && !query.scopes.contains(&entry.scope) { continue; }
        let text_ok = if needle.is_empty() { true } else if let Some(re) = &pattern { re.is_match(&entry.raw) } else if query.case_sensitive { entry.raw.contains(&needle) } else { entry.raw.to_lowercase().contains(&needle) };
        if !text_ok { continue; }
        if matched >= query.offset && items.len() < query.limit { items.push(entry.clone()); }
        matched += 1;
    }
    Ok(QueryResult { items, matched, total: store.entries.len(), elapsed_ms: started.elapsed().as_millis(), error: None })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(LogStore::default()))
        .invoke_handler(tauri::generate_handler![open_log, refresh_log, query_logs, set_field_config])
        .run(tauri::generate_context!()).expect("error while running Tracebeam");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_mapping_recognizes_timestamp() {
        let entry = parse_entry(0, br#"{"timestamp":"2026-08-03T10:00:00Z","level":"info","message":"ready"}
"#, &FieldConfig::default()).unwrap();
        assert_eq!(entry.timestamp, "2026-08-03T10:00:00Z");
        assert_eq!(entry.level, "INFO");
    }

    #[test]
    fn custom_mapping_supports_nested_paths() {
        let fields = FieldConfig {
            time_fields: vec!["meta.created_at".into()],
            level_fields: vec!["meta.kind".into()],
            scope_fields: vec!["context.area".into()],
            message_fields: vec!["payload.text".into()],
        };
        let entry = parse_entry(0, br#"{"meta":{"created_at":42,"kind":"warn"},"context":{"area":"api"},"payload":{"text":"slow"}}
"#, &fields).unwrap();
        assert_eq!(entry.timestamp, "42");
        assert_eq!(entry.level, "WARN");
        assert_eq!(entry.scope, "api");
        assert_eq!(entry.message, "slow");
    }
}
