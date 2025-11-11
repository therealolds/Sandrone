// SQL Formatter (ES module)
// Turns each non-empty line into a quoted SQL value.
// Options:
//  - mode: 'vertical' | 'inline'
//  - quote: "'" | '"'
//  - wrapInParens: boolean
//  - ignoreEmpty: boolean (default true)

function escapeQuote(s, q) {
  // SQL escaping of the same quote by doubling it
  if (q === "'") return s.replace(/'/g, "''");
  if (q === '"') return s.replace(/"/g, '""');
  return s;
}

export function format(input, opts = {}) {
  const mode = (opts.mode || 'vertical').toLowerCase();
  const quote = opts.quote || "'";
  const wrapInParens = !!opts.wrapInParens;
  const ignoreEmpty = opts.ignoreEmpty !== false;

  const lines = (input || '').split(/\r?\n/).map(s => s.trim());
  const values = (ignoreEmpty ? lines.filter(s => s.length > 0) : lines)
    .map(v => `${quote}${escapeQuote(v, quote)}${quote}`);

  if (values.length === 0) return wrapInParens ? '()' : '';

  if (mode === 'inline') {
    const body = values.join(', ');
    return wrapInParens ? `(${body})` : body;
  }

  // vertical: each on its own line, with trailing comma except last
  const out = values.map((v, i) => (i < values.length - 1 ? `${v},` : v)).join('\n');
  return wrapInParens ? `(${out})` : out;
}

export default { format };

