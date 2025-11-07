// CSV Comparator (ES module)
// Multiset comparison of rows between two CSV inputs.

function parseCSV(text, delimiter = ',', { ignoreEmpty = true } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    if (!(ignoreEmpty && row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  const chars = Array.from(text || '');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inQuotes) {
      if (c === '"') {
        const next = chars[i + 1];
        if (next === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { pushField(); continue; }
    if (c === '\n') { pushField(); pushRow(); continue; }
    if (c === '\r') { // handle CRLF or lone CR
      const next = chars[i + 1];
      if (next === '\n') i++;
      pushField(); pushRow();
      continue;
    }
    field += c;
  }
  // Flush last field/row
  pushField();
  if (!(ignoreEmpty && row.length === 1 && row[0] === '')) rows.push(row);
  return rows;
}

function toKey(row) {
  // Use JSON to avoid delimiter collision
  return JSON.stringify(row);
}

function countRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = toKey(r);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

export function compare(text1, text2, opts = {}) {
  const delimiter = opts.delimiter ?? ',';
  const ignoreHeader = !!opts.ignoreHeader;
  const ignoreEmpty = opts.ignoreEmpty !== false;

  const rows1 = parseCSV(text1, delimiter, { ignoreEmpty });
  const rows2 = parseCSV(text2, delimiter, { ignoreEmpty });

  const eff1 = ignoreHeader && rows1.length ? rows1.slice(1) : rows1;
  const eff2 = ignoreHeader && rows2.length ? rows2.slice(1) : rows2;

  const c1 = countRows(eff1);
  const c2 = countRows(eff2);

  const allKeys = new Set([...c1.keys(), ...c2.keys()]);
  const missingInFile2 = [];
  const missingInFile1 = [];
  for (const k of allKeys) {
    const n1 = c1.get(k) || 0;
    const n2 = c2.get(k) || 0;
    if (n1 > n2) {
      for (let i = 0; i < n1 - n2; i++) missingInFile2.push(JSON.parse(k));
    } else if (n2 > n1) {
      for (let i = 0; i < n2 - n1; i++) missingInFile1.push(JSON.parse(k));
    }
  }

  return { missingInFile2, missingInFile1 };
}

export default { compare };

