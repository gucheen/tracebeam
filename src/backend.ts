import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { FieldConfig, FileInfo, LogQuery, QueryResult, SessionFileInfo, UpdateInfo } from './types';

export async function chooseLogPath(): Promise<string | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Log files', extensions: ['log', 'jsonl', 'txt', 'ndjson', 'json'] }],
  });
  return path ? String(path) : null;
}

export const openLog = (sessionId: string, path: string) => invoke<FileInfo>('open_log', { sessionId, path });
export const closeLog = (sessionId: string) => invoke<boolean>('close_log', { sessionId });
export const queryLogs = (sessionId: string, query: LogQuery) => invoke<QueryResult>('query_logs', { sessionId, query });
export const exportLogs = (sessionId: string, query: LogQuery, path: string, format: 'jsonl' | 'csv') =>
  invoke<number>('export_logs', { sessionId, query, path, format });
export const refreshLog = (sessionId: string) => invoke<FileInfo>('refresh_log', { sessionId });
export const updateFieldConfig = (config: FieldConfig) =>
  invoke<SessionFileInfo[]>('set_field_config', { config });
export const takeStartupPaths = () => invoke<string[]>('take_startup_paths');
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

export async function listenForOpenPaths(onPaths: (paths: string[]) => void): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  await listen<string[]>('open-paths', event => onPaths(event.payload));
}
