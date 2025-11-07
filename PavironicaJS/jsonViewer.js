// JSON Viewer helpers (ES module)
// - formatJson: pretty-print JSON
// - renderTree: render interactive collapsible JSON tree

export function formatJson(text, indent = 2) {
  const t = (text ?? '').trim();
  if (!t) return '';
  let obj;
  try {
    obj = JSON.parse(t);
  } catch (e) {
    throw new Error('Invalid JSON: ' + (e && e.message ? e.message : String(e)));
  }
  const n = Number.isFinite(indent) ? Math.max(0, Math.floor(indent)) : 2;
  return JSON.stringify(obj, null, n);
}

function textFor(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  return String(value);
}

function createScalar(value, key) {
  const line = document.createElement('div');
  line.className = 'line';
  if (key !== undefined) {
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key)) ? String(key) : JSON.stringify(String(key));
    line.appendChild(k);
    const colon = document.createElement('span');
    colon.className = 'punct';
    colon.textContent = ': ';
    line.appendChild(colon);
  }
  const v = document.createElement('span');
  const t = typeof value;
  v.className = t === 'string' ? 'string' : t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : value === null ? 'null' : '';
  v.textContent = textFor(value);
  line.appendChild(v);
  return line;
}

function createNode(value, key) {
  const node = document.createElement('div');
  node.className = 'node';

  const isArray = Array.isArray(value);
  const isObj = value && typeof value === 'object' && !isArray;

  if (!isArray && !isObj) {
    node.appendChild(createScalar(value, key));
    return node;
  }

  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  const line = document.createElement('div');
  line.className = 'line';
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  toggle.textContent = '−';
  toggle.title = 'Collapse/Expand';
  line.appendChild(toggle);

  if (key !== undefined) {
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key)) ? String(key) : JSON.stringify(String(key));
    line.appendChild(k);
    const colon = document.createElement('span');
    colon.className = 'punct';
    colon.textContent = ': ';
    line.appendChild(colon);
  }

  const bracketOpen = document.createElement('span');
  bracketOpen.className = 'punct';
  bracketOpen.textContent = open;
  line.appendChild(bracketOpen);

  const summary = document.createElement('span');
  summary.className = 'summary';
  summary.style.display = 'none';
  const count = isArray ? value.length : Object.keys(value).length;
  summary.textContent = isArray ? `… ${count} item${count === 1 ? '' : 's'} …` : `… ${count} key${count === 1 ? '' : 's'} …`;
  line.appendChild(summary);

  node.appendChild(line);

  const children = document.createElement('div');
  children.className = 'children';

  if (isArray) {
    value.forEach((val, idx) => {
      const child = createNode(val);
      // Add index decoration as key-like prefix
      const firstLine = child.querySelector('.line');
      if (firstLine) {
        const idxSpan = document.createElement('span');
        idxSpan.className = 'key';
        idxSpan.textContent = `[${idx}]`;
        firstLine.insertBefore(idxSpan, firstLine.firstChild);
        const colon = document.createElement('span');
        colon.className = 'punct';
        colon.textContent = ': ';
        firstLine.insertBefore(colon, idxSpan.nextSibling);
      }
      children.appendChild(child);
      // trailing comma between items
      const comma = document.createElement('div');
      comma.className = 'line';
      const punct = document.createElement('span');
      punct.className = 'punct';
      punct.textContent = ',';
      comma.appendChild(punct);
      children.appendChild(comma);
    });
    if (children.lastChild) children.removeChild(children.lastChild); // remove last comma
  } else {
    const keys = Object.keys(value);
    keys.forEach((k) => {
      const child = createNode(value[k], k);
      children.appendChild(child);
      const comma = document.createElement('div');
      comma.className = 'line';
      const punct = document.createElement('span');
      punct.className = 'punct';
      punct.textContent = ',';
      comma.appendChild(punct);
      children.appendChild(comma);
    });
    if (children.lastChild) children.removeChild(children.lastChild);
  }

  const closing = document.createElement('div');
  closing.className = 'line';
  const bracketClose = document.createElement('span');
  bracketClose.className = 'punct';
  bracketClose.textContent = close;
  closing.appendChild(bracketClose);
  children.appendChild(closing);

  node.appendChild(children);

  // Toggle behavior
  toggle.addEventListener('click', () => {
    const collapsed = node.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '+' : '−';
    summary.style.display = collapsed ? '' : 'none';
  });

  return node;
}

export function renderTree(container, obj) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(createNode(obj));
}

export function expandAll(container) {
  if (!container) return;
  container.querySelectorAll('.node.collapsed').forEach(n => {
    n.classList.remove('collapsed');
    const t = n.querySelector(':scope > .line .toggle');
    const s = n.querySelector(':scope > .line .summary');
    if (t) t.textContent = '−';
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

// -------- Graph (SVG) Renderer --------

function buildTree(obj, key = undefined, idStart = { v: 1 }, depth = 0) {
  const id = idStart.v++;
  const isArray = Array.isArray(obj);
  const isObj = obj && typeof obj === 'object' && !isArray;
  const node = { id, key, depth, type: isArray ? 'array' : isObj ? 'object' : typeof obj, value: isArray || isObj ? null : obj, children: [] };
  if (isArray) {
    for (let i = 0; i < obj.length; i++) {
      node.children.push({ edge: String(i), child: buildTree(obj[i], undefined, idStart, depth + 1) });
    }
  } else if (isObj) {
    for (const k of Object.keys(obj)) {
      node.children.push({ edge: k, child: buildTree(obj[k], k, idStart, depth + 1) });
    }
  }
  return node;
}

function nodeLabel(n) {
  if (n.type === 'object') return ['Object', `{${n.children.length} keys}`];
  if (n.type === 'array') return ['Array', `[${n.children.length} items]`];
  // scalar
  const v = textFor(n.value);
  if (n.key === undefined) return [v];
  return [String(n.key) + ':', v];
}

function measureLayout(node, cfg) {
  const padY = cfg.nodeVPad;
  const lineH = cfg.lineHeight;
  const lines = nodeLabel(node).length;
  const selfH = lines * lineH + padY * 2;
  if (!node.children.length) { node._subH = selfH; return node._subH; }
  let sum = 0;
  for (const { child } of node.children) {
    sum += measureLayout(child, cfg) + cfg.vGap;
  }
  sum -= cfg.vGap; // remove last gap
  node._subH = Math.max(selfH, sum);
  return node._subH;
}

function layout(node, cfg, x0, y0) {
  node.x = x0;
  if (!node.children.length) { node.y = y0 + node._subH / 2; return; }
  // position children first
  let curY = y0;
  for (const e of node.children) {
    layout(e.child, cfg, x0 + cfg.xGap, curY);
    curY += e.child._subH + cfg.vGap;
  }
  const first = node.children[0].child;
  const last = node.children[node.children.length - 1].child;
  node.y = (first.y + last.y) / 2;
}

function drawNode(g, node, cfg) {
  const lines = nodeLabel(node);
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
  const fill = node.type === 'object' ? '#0d1b2a' : node.type === 'array' ? '#0e1a24' : '#0c1220';
  rect.setAttribute('fill', fill);
  rect.setAttribute('stroke', '#1f2937');
  g.appendChild(rect);

  for (let i = 0; i < lines.length; i++) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', String(x + 10));
    t.setAttribute('y', String(y + cfg.nodeVPad + (i + 1) * lineH - 4));
    t.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace');
    t.setAttribute('font-size', '12');
    t.setAttribute('fill', '#e5e7eb');
    if (i === 0 && (node.type === 'object' || node.type === 'array')) t.setAttribute('fill', '#93c5fd');
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
    const lx = (x1 + x2) / 2;
    const ly = (y1 + y2) / 2 - 4;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(lx));
    text.setAttribute('y', String(ly));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#9ca3af');
    text.textContent = String(label);
    g.appendChild(text);
  }
}

function collectNodes(node, arr = []) { arr.push(node); for (const e of node.children) collectNodes(e.child, arr); return arr; }

export function renderGraph(svg, obj) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const cfg = { nodeWidth: 180, nodeVPad: 10, lineHeight: 16, xGap: 220, vGap: 16 };
  const root = buildTree(obj);
  measureLayout(root, cfg);
  layout(root, cfg, 20, 20);

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(g);

  // edges first
  (function drawEdges(n){
    for (const e of n.children) {
      drawEdge(g, n, e.child, e.edge, cfg);
      drawEdges(e.child);
    }
  })(root);

  // nodes on top
  for (const n of collectNodes(root)) drawNode(g, n, cfg);

  // Set intrinsic size
  const nodes = collectNodes(root);
  const maxX = Math.max(...nodes.map(n => n.x)) + cfg.nodeWidth + 20;
  const maxY = Math.max(...nodes.map(n => n.y)) + 20;
  svg.setAttribute('viewBox', `0 0 ${Math.ceil(maxX)} ${Math.ceil(maxY)}`);
  svg.setAttribute('width', String(Math.ceil(maxX)));
  svg.setAttribute('height', String(Math.ceil(maxY)));
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
    // Only left button
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

export default { formatJson, renderTree, expandAll, collapseAll, renderGraph, fitToContent, enablePanScroll };
