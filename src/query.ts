import type { LogQuery, QueryExtras } from './types';

export const emptyQueryExtras = (): QueryExtras => ({
  fieldFilters: [],
  timeStartMs: null,
  timeEndMs: null,
  context: 0,
  invalidOnly: false,
});

export function buildLogQuery(
  base: Pick<LogQuery, 'text' | 'regex' | 'caseSensitive' | 'levels' | 'scopes' | 'offset' | 'limit'>,
  extras: QueryExtras,
): LogQuery {
  return {
    ...base,
    fieldFilters: extras.fieldFilters.map(filter => ({ ...filter })),
    timeStartMs: extras.timeStartMs,
    timeEndMs: extras.timeEndMs,
    context: extras.context,
    invalidOnly: extras.invalidOnly,
  };
}

export function dateTimeInputValue(milliseconds: number | null): string {
  if (milliseconds === null) return '';
  const date = new Date(milliseconds - new Date(milliseconds).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 19);
}

export function dateTimeMilliseconds(value: string): number | null {
  if (!value) return null;
  const milliseconds = new Date(value).getTime();
  return Number.isNaN(milliseconds) ? null : milliseconds;
}
