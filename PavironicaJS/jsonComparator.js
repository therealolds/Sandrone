// JSON Comparator (ES module)
// Modes:
//  - exact: raw text compare; returns simple +/- line diffs
//  - full: structural compare; sorts object keys and arrays (order-insensitive arrays)
//  - ordered: structural compare; sorts object keys but preserves array order

function sortJson(obj, mode = 'full') {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    const norm = obj.map(x => sortJson(x, mode));
    if (mode === 'full') {
      return [...norm].sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    }
    return norm;
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortJson(obj[k], mode);
    }
    return out;
  }
  return obj;
}

function* findDifferences(o1, o2, path = '') {
  const here = (p) => (p ? p : '');
  if (Array.isArray(o1) && Array.isArray(o2)) {
    const n = Math.min(o1.length, o2.length);
    for (let i = 0; i < n; i++) {
      yield* findDifferences(o1[i], o2[i], `${path}[${i}]`);
    }
    if (o1.length > o2.length) {
      for (let i = o2.length; i < o1.length; i++) {
        yield `Item '${here(path)}[${i}]' only in first.`;
      }
    } else if (o2.length > o1.length) {
      for (let i = o1.length; i < o2.length; i++) {
        yield `Item '${here(path)}[${i}]' only in second.`;
      }
    }
    return;
  }

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(o1) && isObj(o2)) {
    const keys = new Set([...Object.keys(o1), ...Object.keys(o2)]);
    for (const k of [...keys].sort()) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in o1)) {
        yield `Key '${p}' only in second file.`;
      } else if (!(k in o2)) {
        yield `Key '${p}' only in first file.`;
      } else {
        yield* findDifferences(o1[k], o2[k], p);
      }
    }
    return;
  }

  // Primitive compare
  if (o1 !== o2) {
    const show = (v) => typeof v === 'string' ? JSON.stringify(v) : String(v);
    yield `Diff at '${here(path)}': ${show(o1)} != ${show(o2)}`;
  }
}

function lineDiff(aText, bText) {
  const a = (aText || '').split(/\r?\n/);
  const b = (bText || '').split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    if (la === undefined) out.push(`+ ${lb}`);
    else if (lb === undefined) out.push(`- ${la}`);
    else if (la !== lb) { out.push(`- ${la}`); out.push(`+ ${lb}`); }
  }
  return out;
}

export function compare(text1, text2, opts = {}) {
  const m = (opts.mode || 'full').toLowerCase();
  const mode = (m === 'order' || m === 'ordered' || m === 'arrays' || m === 'preserve') ? 'ordered' : (m === 'exact' ? 'exact' : 'full' === m ? 'full' : 'ordered');
  if (mode === 'exact') {
    if (text1 === text2) return [];
    return lineDiff(text1, text2);
  }
  let j1, j2;
  try { j1 = JSON.parse(text1); } catch (e) { throw new Error(`File A is not valid JSON: ${e.message}`); }
  try { j2 = JSON.parse(text2); } catch (e) { throw new Error(`File B is not valid JSON: ${e.message}`); }
  const s1 = sortJson(j1, mode === 'full' ? 'full' : 'ordered');
  const s2 = sortJson(j2, mode === 'full' ? 'full' : 'ordered');
  return Array.from(findDifferences(s1, s2));
}

export default { compare };
