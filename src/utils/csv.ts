export function toCsv(rows: (string | number)[][]): string {
  return rows.map(row => row.map(value => {
    const text = typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? `'${value}` : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}
