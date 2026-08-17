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

## Releasing and online updates

Tracebeam checks `gucheen/tracebeam` GitHub Releases for signed updates. The repository and its Releases must be public so installed clients can download `latest.json` and update packages without a GitHub token. Before the first release, add the generated private key as the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the command below requires GitHub CLI):

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < .tauri-signing/tracebeam.key
```

Keep `.tauri-signing/tracebeam.key` backed up securely; losing it prevents existing installations from accepting future updates. The key is ignored by Git. To publish, update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`, commit the change, then push the matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The release workflow builds macOS (Apple Silicon and Intel) and Windows installers, signs the updater artifacts, and uploads `latest.json` to the GitHub Release.
