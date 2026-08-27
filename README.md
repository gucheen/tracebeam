# Tracebeam

A lightweight, cross-platform desktop viewer for exploring continuously growing JSONL logs.

![Tracebeam showing a simulated JSONL log](docs/tracebeam-preview.jpg)

The screenshot uses [`examples/demo.jsonl`](examples/demo.jsonl). While developing, open `http://127.0.0.1:1420/?demo` to reproduce the preview without the desktop file picker.

## Features

### Fast log exploration

- Incrementally indexes appended log lines and refreshes an open file automatically.
- Uses virtual scrolling and query caching to keep large files responsive.
- Opens files from the picker or drag and drop, with quick access to recently opened logs.
- Jumps to the latest match or continuously follows new matching entries.

### Powerful querying

- Searches plain text or regular expressions, with optional case sensitivity.
- Filters by log level, scope, local time range, and malformed JSON entries.
- Combines nested structured-field conditions such as `http.status >= 500`; array paths such as `items.0.status` are also supported.
- Adds up to 100 surrounding context lines while keeping direct matches visually distinct.
- Supports configurable nested field mappings for timestamps, levels, scopes, and messages.

### Inspection and export

- Displays structured JSON details with inline actions for turning any field into a filter.
- Preserves malformed non-empty lines as `INVALID`, including their physical line number and parser error.
- Supports single, multi, and Shift-range selection, plus copying the original JSONL lines.
- Exports every direct match to JSONL or CSV without including context-only rows.

### Desktop experience

- Includes dark and light themes and signed in-app updates.

## JSONL format

Each non-empty line should contain one JSON object. Tracebeam recognizes these fields by default:

- Timestamp: `timestamp`, `time`, `ts`, `@timestamp`
- Level: `level`, `severity`, `logLevel`
- Scope: `scope`, `namespace`, `module`, `logger`
- Message: `message`, `msg`, `event`, `name`

All other metadata remains available in the detail view, and the default mappings can be customized from the app.

## Development

```bash
pnpm install
pnpm dev
```
