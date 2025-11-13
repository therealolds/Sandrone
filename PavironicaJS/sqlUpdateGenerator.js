// SQL Update Generator utilities
// Parses CSV-like text and builds UPDATE statements row by row.

const DEFAULT_DELIMS = [';', ',', '\t', '|'];

function getFirstContentLine(text) {
  const lines = (text || '').split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length) return line;
  }
  return '';
}

export function detectDelimiter(sample) {
  const firstLine = getFirstContentLine(sample);
  if (!firstLine) return ';';
  let best = ';';
  let bestCount = -1;
  for (const delim of DEFAULT_DELIMS) {
    const re = new RegExp(escapeRegExp(delim), 'g');
    const count = (firstLine.match(re) || []).length;
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseCsv(text, opts = {}) {
  const input = String(text ?? '');
  const delimiter = (opts.delimiter && opts.delimiter.length)
    ? opts.delimiter[0]
    : detectDelimiter(input);
  const hasHeader = opts.hasHeader !== false;
  const skipEmptyRows = opts.skipEmptyRows !== false;

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length === 0 || (skipEmptyRows && row.every((cell) => !String(cell || '').trim()))) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      pushField();
      pushRow();
      continue;
    }
    if (!inQuotes && char === delimiter) {
      pushField();
      continue;
    }
    field += char;
  }
  pushField();
  if (row.length || field.length) pushRow();

  if (!rows.length) {
    return { headers: [], rows: [], delimiter };
  }

  const headers = hasHeader ? rows.shift().map((h, idx) => (h && h.trim()) ? h.trim() : `COL_${idx + 1}`) :
    rows[0].map((_, idx) => `COL_${idx + 1}`);

  // Normalize row widths
  const normalizedRows = rows.map((r) => {
    const rowCopy = Array.from(headers, (_, idx) => r[idx] ?? '');
    return rowCopy;
  });

  return { headers, rows: normalizedRows, delimiter };
}

export function rowsToObjects(headers, rows) {
  const objs = [];
  for (const row of rows) {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? '';
    });
    objs.push(obj);
  }
  return objs;
}

function escapeSqlValue(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function formatValue(value, opts = {}) {
  const trimmed = opts.trimValues !== false ? String(value ?? '').trim() : String(value ?? '');
  if (!trimmed.length) return 'NULL';
  const quote = opts.quote !== false;
  if (!quote) return trimmed;
  return `'${escapeSqlValue(trimmed)}'`;
}

export function generateUpdateStatements(records, config) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error('No data rows available.');
  }
  const tableName = (config?.tableName || '').trim();
  if (!tableName) throw new Error('Table name is required.');
  const whereColumns = Array.isArray(config?.whereColumns)
    ? config.whereColumns.filter((c) => c && c.trim().length)
    : (config?.whereColumn ? [config.whereColumn] : []);
  if (!whereColumns.length) throw new Error('Select at least one column for the WHERE clause.');
  const whereSet = new Set(whereColumns);

  const trimValues = config?.trimValues !== false;
  const defaultQuote = config?.defaultQuote !== false;
  const columnQuoteMap = config?.columnQuoteMap || {};
  const columnUpdateMap = config?.columnUpdateMap || {};

  const getQuoteForColumn = (col) => {
    if (Object.prototype.hasOwnProperty.call(columnQuoteMap, col)) {
      return columnQuoteMap[col];
    }
    return defaultQuote;
  };
  const shouldUpdateColumn = (col) => {
    if (Object.prototype.hasOwnProperty.call(columnUpdateMap, col)) {
      return !!columnUpdateMap[col];
    }
    return !whereSet.has(col);
  };

  const statements = [];
  const skipped = [];

  for (const [index, row] of records.entries()) {
    const missingWhere = whereColumns.filter((col) => {
      const value = row[col];
      return value == null || String(value).trim() === '';
    });
    if (missingWhere.length) {
      skipped.push(index + 1);
      continue;
    }
    const assignments = [];
    for (const [key, value] of Object.entries(row)) {
      if (!shouldUpdateColumn(key)) continue;
      assignments.push(`${key} = ${formatValue(value, { trimValues, quote: getQuoteForColumn(key) })}`);
    }
    if (!assignments.length) {
      skipped.push(index + 1);
      continue;
    }
    const whereClause = whereColumns
      .map((col) => `${col} = ${formatValue(row[col], { trimValues, quote: getQuoteForColumn(col) })}`)
      .join(' AND ');
    statements.push(`UPDATE ${tableName} SET ${assignments.join(', ')} WHERE ${whereClause};`);
  }

  return { statements, skipped };
}

export function buildUpdatesFromCsv(text, config, opts = {}) {
  const parsed = parseCsv(text, opts);
  if (!parsed.headers.length) {
    throw new Error('CSV appears empty or lacks headers.');
  }
  const records = rowsToObjects(parsed.headers, parsed.rows);
  return generateUpdateStatements(records, config);
}

export default {
  detectDelimiter,
  parseCsv,
  rowsToObjects,
  generateUpdateStatements,
  buildUpdatesFromCsv,
};
