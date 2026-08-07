# Tracebeam

A lightweight, cross-platform desktop viewer for continuously growing JSONL logs. The Rust core incrementally indexes appended lines; the UI provides fast text/regex search, level and scope filters, pagination, live refresh, and structured JSON inspection.

![Tracebeam showing a simulated JSONL log](docs/tracebeam-preview.jpg)

The screenshot uses [`examples/demo.jsonl`](examples/demo.jsonl). While developing, open `http://127.0.0.1:1420/?demo` to reproduce the preview without the desktop file picker.

## Development

```bash
pnpm install
pnpm dev
```

Each line should contain one JSON object. Tracebeam recognizes `timestamp`/`time`/`ts`, `level`/`severity`, `scope`/`namespace`/`module`, and `message`/`msg` automatically while keeping all other metadata available in the detail view.
