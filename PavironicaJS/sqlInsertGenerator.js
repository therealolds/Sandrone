// SQL Insert Generator utilities
// Parses CSV text and turns each row into an INSERT statement.

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

  const headers = hasHeader
    ? rows.shift().map((h, idx) => (h && h.trim()) ? h.trim() : `COL_${idx + 1}`)
    : rows[0].map((_, idx) => `COL_${idx + 1}`);

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

export function generateInsertStatements(records, config = {}) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error('No data rows available.');
  }
  const tableName = (config.tableName || '').trim();
  if (!tableName) throw new Error('Table name is required.');

  const defaultCols = Object.keys(records[0]);
  const requestedColumns = Array.isArray(config.columns) && config.columns.length
    ? config.columns
    : defaultCols;

  if (!requestedColumns.length) {
    throw new Error('No columns detected.');
  }

  const trimValues = config.trimValues !== false;
  const defaultQuote = config.defaultQuote !== false;
  const columnQuoteMap = config.columnQuoteMap || {};

  const shouldQuote = (col) => {
    if (Object.prototype.hasOwnProperty.call(columnQuoteMap, col)) {
      return columnQuoteMap[col];
    }
    return defaultQuote;
  };

  const statements = [];
  const skipped = [];

  records.forEach((row, index) => {
    const values = requestedColumns.map((col) =>
      formatValue(row[col], { trimValues, quote: shouldQuote(col) }),
    );
    if (!values.length) {
      skipped.push(index + 1);
      return;
    }
    statements.push(`INSERT INTO ${tableName} (${requestedColumns.join(', ')}) VALUES (${values.join(', ')});`);
  });

  return { statements, skipped };
}

export function buildInsertsFromCsv(text, config, opts = {}) {
  const parsed = parseCsv(text, opts);
  if (!parsed.headers.length) {
    throw new Error('CSV appears empty or lacks headers.');
  }
  const records = rowsToObjects(parsed.headers, parsed.rows);
  return generateInsertStatements(records, {
    ...config,
    columns: config?.columns && config.columns.length ? config.columns : parsed.headers,
  });
}

export default {
  detectDelimiter,
  parseCsv,
  rowsToObjects,
  generateInsertStatements,
  buildInsertsFromCsv,
};

