import type { ExportColumn } from './export.types';

export function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function escapeCsv(value: unknown): string {
  const text = cellText(value);
  // Prevent spreadsheet formula injection while preserving ordinary values.
  const safe = /^[\s]*[=+@]/.test(text) || /^[\s]*-[0-9]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv<T>(rows: T[], columns: Array<ExportColumn<T> & { outputLabel: string }>): string {
  return [
    columns.map((column) => escapeCsv(column.outputLabel)).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsv(column.value(row))).join(',')),
  ].join('\r\n');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
