// XML Viewer helpers (ES module)
// - formatXml: pretty-print XML
// - renderXmlTree: render interactive collapsible XML tree
//   (lines carry data-path like catalog/book[2]/@id; Alt+click a toggle
//    expands/collapses the whole subtree)
// - renderXmlTable / setTableViewOpen / toggleTablePath: grouped table view

function parseXml(text, label = 'XML') {
  const t = (text ?? '').trim();
  if (!t) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(t, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) {
    const msg = err.textContent || 'Unknown parse error';
    throw new Error(`${label} parse error: ${msg.replace(/\s+/g, ' ').trim()}`);
  }
  return doc.documentElement; // root element
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function serializeNode(node, indent, depth) {
  const pad = indent > 0 ? ' '.repeat(indent * depth) : '';
  if (node.nodeType === Node.TEXT_NODE) {
    const txt = (node.nodeValue || '').trim();
    if (!txt) return '';
    return pad + escapeText(txt);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName;
  const attrs = [];
  if (node.attributes) {
    const names = Array.from(node.attributes).map(a => a.name).sort();
    for (const name of names) {
      const val = node.getAttribute(name);
      attrs.push(`${name}="${escapeAttr(val)}"`);
    }
  }
  const open = attrs.length ? `<${tag} ${attrs.join(' ')}>` : `<${tag}>`;
  const children = Array.from(node.childNodes);
  const childParts = [];
  for (const ch of children) {
    const s = serializeNode(ch, indent, depth + 1);
    if (s !== '') childParts.push(s);
  }

  if (childParts.length === 0) {
    return pad + open.replace(/>$/, '/>');
  }

  // Inline text-only content
  const onlyText = childParts.length === 1 && children.length === 1 && children[0].nodeType === Node.TEXT_NODE;
  if (onlyText || indent === 0) {
    const inner = childParts.join('');
    return pad + open + inner.replace(/^\s+|\s+$/g, '') + `</${tag}>`;
  }

  const nl = '\n';
  const body = childParts.map(s => s).join(nl);
  return pad + open + nl + body + nl + pad + `</${tag}>`;
}

export function formatXml(text, indent = 2) {
  const n = Number.isFinite(indent) ? Math.max(0, Math.min(10, Math.floor(indent))) : 2;
  const root = parseXml(text, 'XML');
  if (!root) return '';
  const out = serializeNode(root, n, 0);
  return out + (n > 0 ? '\n' : '');
}

// -------- Interactive tree --------

function setNodeCollapsed(node, collapsed) {
  node.classList.toggle('collapsed', collapsed);
  const t = node.querySelector(':scope > .line .toggle');
  const s = node.querySelector(':scope > .line .summary');
  if (t) t.textContent = collapsed ? '+' : '-';
  if (s) s.style.display = collapsed ? '' : 'none';
}

function createTextLine(value, path) {
  const line = document.createElement('div');
  line.className = 'line';
  line.dataset.path = path;
  const v = document.createElement('span');
  v.className = 'string';
  v.textContent = JSON.stringify(value);
  line.appendChild(v);
  return line;
}

function createElemNode(elem, path) {
  const node = document.createElement('div');
  node.className = 'node';

  const line = document.createElement('div');
  line.className = 'line';
  line.dataset.path = path;
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  toggle.textContent = '-';
  toggle.title = 'Collapse/Expand (Alt+click: whole subtree)';
  line.appendChild(toggle);

  const name = document.createElement('span');
  name.className = 'key';
  name.textContent = `<${elem.tagName}>`;
  line.appendChild(name);

  const summary = document.createElement('span');
  summary.className = 'summary';
  summary.style.display = 'none';
  const attrCount = elem.attributes ? elem.attributes.length : 0;
  const childCount = Array.from(elem.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE).length;
  summary.textContent = `(${attrCount} attr${attrCount === 1 ? '' : 's'}, ${childCount} child${childCount === 1 ? '' : 'ren'})`;
  line.appendChild(summary);

  node.appendChild(line);

  const children = document.createElement('div');
  children.className = 'children';

  // attributes
  if (elem.attributes && elem.attributes.length) {
    Array.from(elem.attributes).forEach(a => {
      const l = document.createElement('div');
      l.className = 'line';
      l.dataset.path = `${path}/@${a.name}`;
      const k = document.createElement('span');
      k.className = 'key';
      k.textContent = '@' + a.name;
      l.appendChild(k);
      const colon = document.createElement('span');
      colon.className = 'punct';
      colon.textContent = ': ';
      l.appendChild(colon);
      const v = document.createElement('span');
      v.className = 'string';
      v.textContent = JSON.stringify(a.value);
      l.appendChild(v);
      children.appendChild(l);
    });
  }

  // child nodes; repeated sibling tags get a 1-based [n] disambiguator
  const tagTotals = new Map();
  for (const ch of elem.childNodes) {
    if (ch.nodeType === Node.ELEMENT_NODE) tagTotals.set(ch.tagName, (tagTotals.get(ch.tagName) || 0) + 1);
  }
  const tagSeen = new Map();
  for (const ch of elem.childNodes) {
    if (ch.nodeType === Node.TEXT_NODE) {
      const t = (ch.nodeValue || '').trim();
      if (!t) continue;
      children.appendChild(createTextLine(t, path));
    } else if (ch.nodeType === Node.ELEMENT_NODE) {
      const tag = ch.tagName;
      const idx = (tagSeen.get(tag) || 0) + 1;
      tagSeen.set(tag, idx);
      const seg = (tagTotals.get(tag) || 0) > 1 ? `${tag}[${idx}]` : tag;
      children.appendChild(createElemNode(ch, `${path}/${seg}`));
    }
  }

  node.appendChild(children);

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const collapsed = node.classList.contains('collapsed');
    if (e.altKey) {
      setNodeCollapsed(node, !collapsed);
      node.querySelectorAll('.node').forEach(n => setNodeCollapsed(n, !collapsed));
      return;
    }
    setNodeCollapsed(node, !collapsed);
  });

  return node;
}

export function renderXmlTree(container, rootElem) {
  if (!container) return;
  container.innerHTML = '';
  if (!rootElem) return;
  container.appendChild(createElemNode(rootElem, rootElem.tagName));
}

export function expandAll(container) {
  if (!container) return;
  container.querySelectorAll('.node.collapsed').forEach(n => setNodeCollapsed(n, false));
}

export function collapseAll(container) {
  if (!container) return;
  container.querySelectorAll('.node').forEach(n => setNodeCollapsed(n, true));
}

// -------- Table view --------

function collectText(node) {
  return Array.from(node.childNodes || [])
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.nodeValue || '')
    .join('')
    .trim();
}

function buildPathId(parts) {
  return parts.map((p) => String(p).trim().toLowerCase()).filter(Boolean).join('/');
}

function normalizePathParts(value) {
  const parts = Array.isArray(value)
    ? value.map((p) => String(p))
    : String(value || '').split(/[>/]+/);
  return parts
    .map((p) => p.trim().toLowerCase().replace(/\[\d+\]$/, '')) // tolerate tree paths like book[2]
    .filter((p) => p.length > 0 && !p.startsWith('@') && !p.startsWith('#'));
}

function ensureAncestorDetailsOpen(node) {
  let parent = node ? node.parentElement : null;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
}

function getChildElements(node) {
  return Array.from(node.childNodes || []).filter((n) => n.nodeType === Node.ELEMENT_NODE);
}

function formatAttrList(elem) {
  const attrs = Array.from(elem.attributes || []);
  if (!attrs.length) return '';
  return attrs
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `@${a.name}=${a.value}`)
    .join('\n');
}

function groupChildrenByTag(elem) {
  const groups = new Map();
  getChildElements(elem).forEach((child) => {
    const tag = child.tagName;
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(child);
  });
  return Array.from(groups.entries());
}

function buildChildGroups(elem, path = []) {
  const grouped = groupChildrenByTag(elem);
  if (!grouped.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'table-children';

  grouped.forEach(([tag, nodes]) => {
    const section = document.createElement('details');
    section.className = 'table-group';
    section.open = false;
    const groupPath = [...path, tag];
    section.dataset.path = buildPathId(groupPath);

    const heading = document.createElement('summary');
    heading.className = 'table-group-title';
    heading.textContent = `<${tag}> (${nodes.length})`;
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'table-grid table-child-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['#', 'Attributes', 'Text', 'Children'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    nodes.forEach((node, idx) => {
      const row = document.createElement('tr');

      const indexCell = document.createElement('td');
      indexCell.className = 'table-index';
      indexCell.textContent = String(idx + 1);
      row.appendChild(indexCell);

      const attrCell = document.createElement('td');
      attrCell.className = 'table-val';
      attrCell.textContent = formatAttrList(node) || '-';
      row.appendChild(attrCell);

      const textCell = document.createElement('td');
      textCell.className = 'table-val';
      textCell.textContent = collectText(node) || '-';
      row.appendChild(textCell);

      const nestedCell = document.createElement('td');
      nestedCell.className = 'table-nested';
      const nestedGroups = buildChildGroups(node, groupPath);
      if (nestedGroups) {
        nestedCell.appendChild(nestedGroups);
      } else {
        nestedCell.textContent = '-';
      }
      row.appendChild(nestedCell);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    section.appendChild(table);
    wrap.appendChild(section);
  });

  return wrap;
}

function buildTableNode(elem, path = null) {
  const currentPath = path && path.length ? path : [elem.tagName];
  const details = document.createElement('details');
  details.className = 'table-node';
  details.open = false;
  details.dataset.path = buildPathId(currentPath);

  const summary = document.createElement('summary');
  summary.className = 'table-summary';

  const tag = document.createElement('span');
  tag.className = 'table-tag';
  tag.textContent = elem.tagName;
  summary.appendChild(tag);

  const attrs = Array.from(elem.attributes || []).sort((a, b) => a.name.localeCompare(b.name));
  attrs.forEach((a) => {
    const badge = document.createElement('span');
    badge.className = 'table-attr';
    badge.textContent = `@${a.name}=${a.value}`;
    summary.appendChild(badge);
  });

  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'table-body';

  if (attrs.length) {
    const attrTable = document.createElement('table');
    attrTable.className = 'table-grid';
    attrs.forEach((a) => {
      const row = document.createElement('tr');
      const key = document.createElement('td');
      key.className = 'table-key';
      key.textContent = `@${a.name}`;
      const val = document.createElement('td');
      val.className = 'table-val';
      val.textContent = a.value;
      row.appendChild(key);
      row.appendChild(val);
      attrTable.appendChild(row);
    });
    body.appendChild(attrTable);
  }

  const text = collectText(elem);
  if (text) {
    const textRow = document.createElement('div');
    textRow.className = 'table-text';
    textRow.textContent = text;
    body.appendChild(textRow);
  }

  const childGroups = buildChildGroups(elem, currentPath);
  if (childGroups) body.appendChild(childGroups);

  details.appendChild(body);
  return details;
}

export function renderXmlTable(target, rootElem) {
  if (!target) return;
  target.innerHTML = '';
  if (!rootElem) {
    target.textContent = 'No XML to render.';
    return;
  }
  target.appendChild(buildTableNode(rootElem, [rootElem.tagName]));
}

export function setTableViewOpen(target, open) {
  if (!target) return;
  target.querySelectorAll('details.table-node, details.table-group').forEach((d) => { d.open = open; });
}

function findTablesByPath(target, pathInput) {
  if (!target) return [];
  const parts = normalizePathParts(pathInput);
  if (!parts.length) return [];
  const desired = buildPathId(parts);
  return Array.from(target.querySelectorAll('details.table-node, details.table-group'))
    .filter((node) => (node.dataset.path || '') === desired);
}

export function toggleTablePath(target, pathInput, open) {
  const nodes = findTablesByPath(target, pathInput);
  nodes.forEach((node) => {
    if (open) ensureAncestorDetailsOpen(node);
    node.open = open;
  });
  return nodes;
}

export default { formatXml, renderXmlTree, expandAll, collapseAll, renderXmlTable, setTableViewOpen, toggleTablePath };
