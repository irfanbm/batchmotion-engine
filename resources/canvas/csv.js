// Adobe Stock upload CSV: same columns as Sample_Adobe_Stock_CSV_upload.csv.
export const STOCK_COLUMNS = ['Filename', 'Title', 'Keywords', 'Category', 'Releases'];

export const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Returns one object per footage row, tolerating a missing header or reordered columns.
export function readStockRows(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  let order = STOCK_COLUMNS.map((_, i) => i);
  let body = rows;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header.includes('filename')) {
    order = STOCK_COLUMNS.map((col) => header.indexOf(col.toLowerCase()));
    body = rows.slice(1);
  }
  return body
    .map((r) => Object.fromEntries(STOCK_COLUMNS.map((col, i) => [col, (r[order[i]] ?? '').trim()])))
    .filter((r) => r.Filename);
}

// The same filename listed twice keeps only its latest row.
export function mergeStockRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = row.Filename.toLowerCase();
    byName.delete(key);
    byName.set(key, row);
  }
  return { rows: [...byName.values()], duplicates: rows.length - byName.size };
}

export function stockCsvText(rows) {
  const lines = [STOCK_COLUMNS, ...rows.map((r) => STOCK_COLUMNS.map((col) => r[col]))];
  return lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
