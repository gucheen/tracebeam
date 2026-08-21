export type Entry = {
  id: number;
  lineNumber: number;
  timestamp: string;
  level: string;
  scope: string;
  message: string;
  raw: string;
  parseError: string | null;
  contextOnly: boolean;
};

export type FileInfo = {
  path: string;
  name: string;
  size: number;
  total: number;
  invalidJson: number;
  levels: string[];
  scopes: string[];
};

export type QueryResult = {
  items: Entry[];
  matched: number;
  directMatched: number;
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
  fieldFilters: FieldFilter[];
  timeStartMs: number | null;
  timeEndMs: number | null;
  context: number;
  invalidOnly: boolean;
  offset: number;
  limit: number;
};

export type FieldOperator = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'greater' | 'greaterOrEqual' | 'less' | 'lessOrEqual' | 'exists' | 'notExists';

export type FieldFilter = {
  path: string;
  operator: FieldOperator;
  value: string;
};

export type QueryExtras = {
  fieldFilters: FieldFilter[];
  timeStartMs: number | null;
  timeEndMs: number | null;
  context: number;
  invalidOnly: boolean;
};

export type RecentFile = { path: string; name: string; openedAt: number };

export type UpdateInfo = {
  currentVersion: string;
  version: string;
  notes?: string;
};

export const defaultFields: FieldConfig = {
  timeFields: ['timestamp', 'time', 'ts', '@timestamp'],
  levelFields: ['level', 'severity', 'logLevel'],
  scopeFields: ['scope', 'namespace', 'module', 'logger'],
  messageFields: ['message', 'msg', 'event', 'name'],
};
