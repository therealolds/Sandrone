// XML Viewer helpers (ES module)
// - formatXml: pretty-print XML
// - renderXmlTree: render interactive collapsible XML tree

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

function createTextLine(value) {
  const line = document.createElement('div');
  line.className = 'line';
  const v = document.createElement('span');
  v.className = 'string';
  v.textContent = JSON.stringify(value);
  line.appendChild(v);
  return line;
}

function createElemNode(elem) {
  const node = document.createElement('div');
  node.className = 'node';

  const line = document.createElement('div');
  line.className = 'line';
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  toggle.textContent = '-';
  toggle.title = 'Collapse/Expand';
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

  // child nodes
  for (const ch of elem.childNodes) {
    if (ch.nodeType === Node.TEXT_NODE) {
      const t = (ch.nodeValue || '').trim();
      if (!t) continue;
      children.appendChild(createTextLine(t));
    } else if (ch.nodeType === Node.ELEMENT_NODE) {
      children.appendChild(createElemNode(ch));
    }
  }

  node.appendChild(children);

  toggle.addEventListener('click', () => {
    const collapsed = node.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '+' : '-';
    summary.style.display = collapsed ? '' : 'none';
  });

  return node;
}

export function renderXmlTree(container, rootElem) {
  if (!container) return;
  container.innerHTML = '';
  if (!rootElem) return;
  container.appendChild(createElemNode(rootElem));
}

export function expandAll(container) {
  if (!container) return;
  container.querySelectorAll('.node.collapsed').forEach(n => {
    n.classList.remove('collapsed');
    const t = n.querySelector(':scope > .line .toggle');
    const s = n.querySelector(':scope > .line .summary');
    if (t) t.textContent = '-';
    if (s) s.style.display = 'none';
  });
}

export function collapseAll(container) {
  if (!container) return;
  container.querySelectorAll('.node').forEach(n => {
    if (!n.classList.contains('collapsed')) {
      n.classList.add('collapsed');
      const t = n.querySelector(':scope > .line .toggle');
      const s = n.querySelector(':scope > .line .summary');
      if (t) t.textContent = '+';
      if (s) s.style.display = '';
    }
  });
}

export default { formatXml, renderXmlTree, expandAll, collapseAll };
 
// -------- Graph (SVG) Renderer for XML --------

function buildXmlTree(elem, idStart = { v: 1 }, depth = 0) {
  const id = idStart.v++;
  const node = {
    id,
    depth,
    type: 'element',
    tag: elem.tagName,
    attrs: elem.attributes ? Array.from(elem.attributes).map(a => ({ name: a.name, value: a.value })) : [],
    children: []
  };
  for (const ch of elem.childNodes) {
    if (ch.nodeType === Node.TEXT_NODE) {
      const t = (ch.nodeValue || '').trim();
      if (!t) continue;
      node.children.push({ edge: '#text', child: buildXmlTextNode(t, idStart, depth + 1) });
    } else if (ch.nodeType === Node.ELEMENT_NODE) {
      node.children.push({ edge: ch.tagName, child: buildXmlTree(ch, idStart, depth + 1) });
    }
  }
  return node;
}

function buildXmlTextNode(text, idStart, depth) {
  return { id: idStart.v++, depth, type: 'text', text, children: [] };
}

function xmlNodeLabel(n) {
  if (n.type === 'element') {
    const attrCount = n.attrs ? n.attrs.length : 0;
    const childCount = n.children ? n.children.length : 0;
    return [
      `<${n.tag}>`,
      `{${attrCount} attr${attrCount === 1 ? '' : 's'}, ${childCount} child${childCount === 1 ? '' : 'ren'}}`
    ];
  }
  // text node
  const t = n.text.length > 40 ? n.text.slice(0, 37) + '…' : n.text;
  return [JSON.stringify(t)];
}

// Measure subtree height taking collapsed nodes into account
function measureLayout(node, cfg, expanded) {
  const padY = cfg.nodeVPad;
  const lineH = cfg.lineHeight;
  const lines = xmlNodeLabel(node).length;
  const selfH = lines * lineH + padY * 2;
  if (!node.children.length) { node._subH = selfH; return node._subH; }
  if (!expanded.has(node.id)) { node._subH = selfH; return node._subH; }
  let sum = 0;
  node.children.forEach(({ child }, idx) => {
    sum += measureLayout(child, cfg, expanded);
    if (idx < node.children.length - 1) sum += cfg.vGap + (cfg.labelRoom || 0);
  });
  node._subH = Math.max(selfH, sum);
  return node._subH;
}

function layout(node, cfg, x0, y0, expanded) {
  node.x = x0;
  if (!node.children.length || !expanded.has(node.id)) { node.y = y0 + node._subH / 2; return; }
  let curY = y0;
  node.children.forEach((e, idx) => {
    layout(e.child, cfg, x0 + cfg.xGap, curY, expanded);
    if (idx < node.children.length - 1) curY += e.child._subH + cfg.vGap + (cfg.labelRoom || 0);
  });
  const first = node.children[0].child;
  const last = node.children[node.children.length - 1].child;
  node.y = (first.y + last.y) / 2;
}

function drawNode(g, node, cfg) {
  const lines = xmlNodeLabel(node);
  const w = cfg.nodeWidth;
  const lineH = cfg.lineHeight;
  const h = lines.length * lineH + cfg.nodeVPad * 2;
  const x = node.x;
  const y = node.y - h / 2;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('rx', '8');
  rect.setAttribute('ry', '8');
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  const fill = node.type === 'element' ? '#0d1b2a' : '#0c1220';
  rect.setAttribute('fill', fill);
  rect.setAttribute('stroke', '#1f2937');
  g.appendChild(rect);

  for (let i = 0; i < lines.length; i++) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(x + 10));
    t.setAttribute('y', String(y + cfg.nodeVPad + (i + 1) * lineH - 4));
    t.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace');
    t.setAttribute('font-size', '12');
    t.setAttribute('fill', i === 0 && node.type === 'element' ? '#93c5fd' : '#e5e7eb');
    t.textContent = lines[i];
    g.appendChild(t);
  }
}

function drawEdge(g, parent, child, label, cfg) {
  const x1 = parent.x + cfg.nodeWidth;
  const y1 = parent.y;
  const x2 = child.x;
  const y2 = child.y;
  const dx = Math.max(40, (x2 - x1) * 0.5);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#475569');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', '1.5');
  g.appendChild(path);

  if (label !== undefined) {
    const childLines = xmlNodeLabel(child);
    const childH = childLines.length * cfg.lineHeight + cfg.nodeVPad * 2;
    const lx = x2 + cfg.nodeWidth / 2;
    const ly = y2 - childH / 2 - (cfg.labelGap || 6);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(lx));
    text.setAttribute('y', String(ly));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#9ca3af');
    text.setAttribute('pointer-events', 'none');
    text.textContent = String(label);
    g.appendChild(text);
    const bb = text.getBBox();
    const pad = 3;
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(bb.x - pad));
    bg.setAttribute('y', String(bb.y - pad));
    bg.setAttribute('rx', '3');
    bg.setAttribute('ry', '3');
    bg.setAttribute('width', String(bb.width + pad * 2));
    bg.setAttribute('height', String(bb.height + pad * 2));
    bg.setAttribute('fill', '#0b1020');
    bg.setAttribute('stroke', '#1f2937');
    bg.setAttribute('opacity', '0.9');
    g.insertBefore(bg, text);
  }
}

function collectNodes(node, arr = []) { arr.push(node); for (const e of node.children) collectNodes(e.child, arr); return arr; }

function visibleNodes(root, expanded) {
  const out = [];
  (function walk(n){
    out.push(n);
    if (!expanded.has(n.id)) return;
    for (const e of n.children) walk(e.child);
  })(root);
  return out;
}

export function renderGraph(svg, rootElem) {
  if (!svg || !rootElem) return;
  const cfg = { nodeWidth: 180, nodeVPad: 10, lineHeight: 16, xGap: 280, vGap: 18, labelGap: 8, labelRoom: 14 };
  const root = buildXmlTree(rootElem);
  const allById = new Map(collectNodes(root).map(n => [n.id, n]));
  const expanded = new Set(); // collapsed by default

  function rerender() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    measureLayout(root, cfg, expanded);
    layout(root, cfg, 20, 20, expanded);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    (function drawVisibleEdges(n){
      if (expanded.has(n.id)) {
        for (const e of n.children) {
          const label = e.child.type === 'text' ? '#text' : e.child.tag;
          drawEdge(g, n, e.child, label, cfg);
          drawVisibleEdges(e.child);
        }
      }
    })(root);

    const nodes = visibleNodes(root, expanded);
    for (const n of nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-id', String(n.id));
      drawNode(group, n, cfg);
      if (n.children.length) {
        group.style.cursor = 'pointer';
        group.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (expanded.has(n.id)) expanded.delete(n.id); else expanded.add(n.id);
          rerender();
        });
      }
      g.appendChild(group);
    }

    const maxX = Math.max(...nodes.map(n => n.x)) + cfg.nodeWidth + 20;
    const maxY = Math.max(...nodes.map(n => n.y)) + 20;
    svg.setAttribute('viewBox', `0 0 ${Math.ceil(maxX)} ${Math.ceil(maxY)}`);
    svg.setAttribute('width', String(Math.ceil(maxX)));
    svg.setAttribute('height', String(Math.ceil(maxY)));
  }

  rerender();

  svg._graphCtl = {
    expandAll() {
      expanded.clear();
      for (const n of allById.values()) if (n.children.length) expanded.add(n.id);
      rerender();
    },
    collapseAll() {
      expanded.clear();
      rerender();
    }
  };
}

export function fitToContent(svg) {
  if (!svg) return;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+/).map(Number);
    if (parts.length === 4) {
      svg.setAttribute('width', String(parts[2]));
      svg.setAttribute('height', String(parts[3]));
    }
  }
}

export function enablePanScroll(wrapper) {
  if (!wrapper) return;
  let panning = false;
  let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

  const onDown = (e) => {
    if (e.button !== 0) return;
    panning = true;
    wrapper.classList.add('panning');
    startX = e.clientX;
    startY = e.clientY;
    baseLeft = wrapper.scrollLeft;
    baseTop = wrapper.scrollTop;
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!panning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    wrapper.scrollLeft = baseLeft - dx;
    wrapper.scrollTop = baseTop - dy;
    e.preventDefault();
  };

  const onUp = () => {
    if (!panning) return;
    panning = false;
    wrapper.classList.remove('panning');
  };

  wrapper.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function collectText(node) {
  return Array.from(node.childNodes || [])
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.nodeValue || '')
    .join('')
    .trim();
}

function buildTableNode(elem) {
  const details = document.createElement('details');
  details.className = 'table-node';
  details.open = false;

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

  const children = Array.from(elem.childNodes || []).filter((n) => n.nodeType === Node.ELEMENT_NODE);
  if (children.length) {
    const childWrap = document.createElement('div');
    childWrap.className = 'table-children';
    children.forEach((child) => {
      childWrap.appendChild(buildTableNode(child));
    });
    body.appendChild(childWrap);
  }

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
  target.appendChild(buildTableNode(rootElem));
}

export function setTableViewOpen(target, open) {
  if (!target) return;
  target.querySelectorAll('details.table-node').forEach((d) => { d.open = open; });
}

export { renderGraph as renderXmlGraph };
