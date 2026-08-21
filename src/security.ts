const levelToneClasses = new Set([
  'debug', 'error', 'fatal', 'info', 'invalid', 'other', 'trace', 'warn', 'warning',
]);

export function levelToneClass(level: string): string {
  const candidate = level.toLowerCase();
  return levelToneClasses.has(candidate) ? candidate : 'other';
}
