export type Entry = {
  id: number;
  timestamp: string;
  level: string;
  scope: string;
  message: string;
  raw: string;
};

export type FileInfo = {
  path: string;
  name: string;
  size: number;
  total: number;
  levels: string[];
  scopes: string[];
};

export type QueryResult = {
  items: Entry[];
  matched: number;
  total: number;
  elapsedMs: number;
  error?: string;
};

export type FieldConfig = {
  timeFields: string[];
  levelFields: string[];
  scopeFields: string[];
  messageFields: string[];
};

export type LogQuery = {
  text: string;
  regex: boolean;
  caseSensitive: boolean;
  levels: string[];
  scopes: string[];
  offset: number;
  limit: number;
};

export type RecentFile = { path: string; name: string; openedAt: number };

export const defaultFields: FieldConfig = {
  timeFields: ['timestamp', 'time', 'ts', '@timestamp'],
  levelFields: ['level', 'severity', 'logLevel'],
  scopeFields: ['scope', 'namespace', 'module', 'logger'],
  messageFields: ['message', 'msg', 'event', 'name'],
};
