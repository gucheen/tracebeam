# Tracebeam

A lightweight, cross-platform desktop viewer for continuously growing JSONL logs. The Rust core incrementally indexes appended lines; the UI provides fast text/regex search, level and scope filters, pagination, live refresh, and structured JSON inspection.

## Development

```bash
npm install
npm run dev
```

Each line should contain one JSON object. Tracebeam recognizes `timestamp`/`time`/`ts`, `level`/`severity`, `scope`/`namespace`/`module`, and `message`/`msg` automatically while keeping all other metadata available in the detail view.
