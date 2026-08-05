export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

export function parseTimestamp(input: string): Date | null {
  const value = input.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    const digits = value.split('.')[0].length;
    const milliseconds = digits <= 10 ? number * 1000 : digits <= 13 ? number : digits <= 16 ? number / 1000 : number / 1_000_000;
    const date = new Date(milliseconds);
    if (Number.isFinite(number) && !Number.isNaN(date.getTime())) return date;
  }
  const apache = value.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})(?:[.,](\d{1,9}))?\s*([+-]\d{2}:?\d{2})?$/);
  if (apache) {
    const months: Record<string, string> = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    const month = months[apache[2].toLowerCase()];
    if (month) {
      const zone = apache[6]?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') || '';
      const date = new Date(`${apache[3]}-${month}-${apache[1].padStart(2, '0')}T${apache[4]}.${(apache[5] || '0').slice(0, 3).padEnd(3, '0')}${zone}`);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  if (/^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(value)) {
    const date = new Date(`${value} ${new Date().getFullYear()}`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const normalized = value
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/, '$1-$2-$3')
    .replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/, '$1T$2')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d+)/, '$1.$2')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatTime(value: string): string {
  if (!value) return '—';
  if (/^\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?$/.test(value.trim())) return value.trim().replace(',', '.');
  const date = parseTimestamp(value);
  return date ? date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits:3, hour12:false }) : value;
}
