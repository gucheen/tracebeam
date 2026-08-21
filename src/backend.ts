import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { FieldConfig, FileInfo, LogQuery, QueryResult, UpdateInfo } from './types';

export async function chooseLogPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Log files', extensions: ['log', 'jsonl', 'txt', 'ndjson', 'json'] }],
  });
  return path ? String(path) : null;
}

export const openLog = (path: string) => invoke<FileInfo>('open_log', { path });
export const queryLogs = (query: LogQuery) => invoke<QueryResult>('query_logs', { query });
export const exportLogs = (query: LogQuery, path: string, format: 'jsonl' | 'csv') =>
  invoke<number>('export_logs', { query, path, format });
export const refreshLog = () => invoke<FileInfo>('refresh_log');
export const updateFieldConfig = (config: FieldConfig) =>
  invoke<FileInfo | null>('set_field_config', { config });
export const checkForUpdate = () => invoke<UpdateInfo | null>('check_for_update');
export const installUpdate = () => invoke<void>('install_update');
export const getAppVersion = () => getVersion();

export async function chooseExportPath(defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [
      { name: 'JSON Lines', extensions: ['jsonl'] },
      { name: 'CSV', extensions: ['csv'] },
    ],
  });
  return path ? String(path) : null;
}

export function listenForFileDrop(onDrop: (path: string) => void): void {
  if (!('__TAURI_INTERNALS__' in window)) return;
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths[0]) onDrop(event.payload.paths[0]);
  });
}
