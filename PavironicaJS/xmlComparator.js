// XML Comparator (ES module)
// - orderSensitive: when false, compares children after sorting by (tagName, attributes)

function parseXml(text, label = 'XML') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    const msg = err.textContent || 'Unknown parse error';
    throw new Error(`${label} parse error: ${msg.replace(/\s+/g, ' ').trim()}`);
  }
  return doc.documentElement; // root element
}

function attrsMap(node) {
  const out = {};
  if (!node.attributes) return out;
  for (const a of node.attributes) out[a.name] = a.value;
  return out;
}

function attrsKey(attrs) {
  return Object.keys(attrs).sort().map(k => `${k}=${JSON.stringify(attrs[k])}`).join('|');
}

function normalize(node, orderSensitive) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.nodeValue || '').trim();
    return t.length ? t : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName;
  const attrib = attrsMap(node);
  const children = [];
  for (const ch of node.childNodes) {
    const n = normalize(ch, orderSensitive);
    if (n === '' || n === undefined) continue;
    children.push(n);
  }
  // Sort element children only when order is not sensitive
  if (!orderSensitive) {
    children.sort((a, b) => {
      // a and b can be strings (text) or element-like objects
      const ka = typeof a === 'string' ? `#text:${a}` : `${a.tag}:${attrsKey(a.attrib)}`;
      const kb = typeof b === 'string' ? `#text:${b}` : `${b.tag}:${attrsKey(b.attrib)}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  return { tag, attrib, children };
}

function* diff(n1, n2, path = '') {
  // Text nodes (strings)
  const isText1 = typeof n1 === 'string';
  const isText2 = typeof n2 === 'string';
  if (isText1 || isText2) {
    if (n1 !== n2) yield `Text diff at ${path || '/'}: '${n1}' != '${n2}'`;
    return;
  }

  // Element nodes
  if (n1.tag !== n2.tag) yield `Tag diff at ${path || '/'}: ${n1.tag} != ${n2.tag}`;

  const a1 = n1.attrib || {};
  const a2 = n2.attrib || {};
  if (JSON.stringify(a1) !== JSON.stringify(a2)) {
    yield `Attrib diff at ${path || '/'}: ${JSON.stringify(a1)} != ${JSON.stringify(a2)}`;
  }

  const c1 = n1.children || [];
  const c2 = n2.children || [];
  const min = Math.min(c1.length, c2.length);
  for (let i = 0; i < min; i++) {
    const child = c1[i];
    const tag = typeof child === 'string' ? '#text' : child.tag;
    const nextPath = `${path}/${tag}`;
    yield* diff(c1[i], c2[i], nextPath);
  }
  if (c1.length > c2.length) {
    for (let i = c2.length; i < c1.length; i++) {
      const tag = typeof c1[i] === 'string' ? '#text' : c1[i].tag;
      yield `Extra element ${path || '/'}${path ? '/' : ''}${tag} in first.`;
    }
  } else if (c2.length > c1.length) {
    for (let i = c1.length; i < c2.length; i++) {
      const tag = typeof c2[i] === 'string' ? '#text' : c2[i].tag;
      yield `Extra element ${path || '/'}${path ? '/' : ''}${tag} in second.`;
    }
  }
}

export function compare(xmlText1, xmlText2, opts = {}) {
  const orderSensitive = !!opts.orderSensitive;
  const root1 = parseXml(xmlText1, 'XML A');
  const root2 = parseXml(xmlText2, 'XML B');
  const n1 = normalize(root1, orderSensitive);
  const n2 = normalize(root2, orderSensitive);
  return Array.from(diff(n1, n2, `/${root1.tagName}`));
}

export default { compare };

