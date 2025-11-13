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

function appendComma(node) {
  if (!node) return;
  const lines = node.querySelectorAll('.line');
  const target = lines[lines.length - 1] || node;
  const punct = document.createElement('span');
  punct.className = 'punct';
  punct.textContent = ',';
  target.appendChild(punct);
}

function setCollapsed(node, collapsed) {
  if (!node) return;
  if (!collapsed) node._ensureChildren?.();
  if (collapsed) node.classList.add('collapsed'); else node.classList.remove('collapsed');
  if (node._toggle) node._toggle.textContent = collapsed ? '+' : '-';
  if (node._summary) node._summary.style.display = collapsed ? '' : 'none';
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
    node._toggle = null;
    node._summary = null;
    node._children = null;
    node._ensureChildren = null;
    return node;
  }

  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  const line = document.createElement('div');
  line.className = 'line';
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  toggle.title = 'Collapse/Expand';
  toggle.textContent = '-';
  node._toggle = toggle;
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
  summary.textContent = isArray
    ? `(${count} item${count === 1 ? '' : 's'})`
    : `(${count} key${count === 1 ? '' : 's'})`;
  node._summary = summary;
  line.appendChild(summary);

  node.appendChild(line);

  const children = document.createElement('div');
  children.className = 'children';
  node._children = children;
  node.appendChild(children);

  let childrenBuilt = false;
  const buildChildren = () => {
    if (childrenBuilt) return;
    childrenBuilt = true;
    const frag = document.createDocumentFragment();
    if (isArray) {
      value.forEach((val, idx) => {
        const child = createNode(val);
        setCollapsed(child, true);
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
        frag.appendChild(child);
        if (idx < value.length - 1) appendComma(child);
      });
    } else {
      const keys = Object.keys(value);
      keys.forEach((k, i) => {
        const child = createNode(value[k], k);
        setCollapsed(child, true);
        frag.appendChild(child);
        if (i < keys.length - 1) appendComma(child);
      });
    }
    const closing = document.createElement('div');
    closing.className = 'line';
    const bracketClose = document.createElement('span');
    bracketClose.className = 'punct';
    bracketClose.textContent = close;
    closing.appendChild(bracketClose);
    frag.appendChild(closing);
    children.appendChild(frag);
  };
  node._ensureChildren = buildChildren;

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const collapsed = node.classList.contains('collapsed');
    setCollapsed(node, !collapsed);
  });

  return node;
}

export function renderTree(container, obj) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(createNode(obj));
}

function expandNodeRecursive(node) {
  if (!node) return;
  setCollapsed(node, false);
  const children = node._children;
  if (!children) return;
  children.querySelectorAll(':scope > .node').forEach(expandNodeRecursive);
}

export function expandAll(container) {
  if (!container) return;
  const root = container.querySelector('.node');
  if (root) expandNodeRecursive(root);
}

function collapseNodeRecursive(node) {
  if (!node) return;
  setCollapsed(node, true);
  const children = node._children;
  if (!children) return;
  children.querySelectorAll(':scope > .node').forEach(collapseNodeRecursive);
}

export function collapseAll(container) {
  if (!container) return;
  const root = container.querySelector('.node');
  if (root) collapseNodeRecursive(root);
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

// Measure subtree height taking collapsed nodes into account
function measureLayout(node, cfg, expanded) {
  const padY = cfg.nodeVPad;
  const lineH = cfg.lineHeight;
  const lines = nodeLabel(node).length;
  const selfH = lines * lineH + padY * 2;
  if (!node.children.length) { node._subH = selfH; return node._subH; }
  // If node is not expanded, its visual subtree height equals its own height
  if (!expanded.has(node.id)) { node._subH = selfH; return node._subH; }
  let sum = 0;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i].child;
    sum += measureLayout(child, cfg, expanded);
    if (i < node.children.length - 1) sum += cfg.vGap + (cfg.labelRoom || 0);
  }
  node._subH = Math.max(selfH, sum);
  return node._subH;
}

function layout(node, cfg, x0, y0, expanded) {
  node.x = x0;
  if (!node.children.length || !expanded.has(node.id)) {
    node.y = y0 + node._subH / 2; return;
  }
  // position children first (only if expanded)
  let curY = y0;
  for (let i = 0; i < node.children.length; i++) {
    const e = node.children[i];
    layout(e.child, cfg, x0 + cfg.xGap, curY, expanded);
    if (i < node.children.length - 1) curY += e.child._subH + cfg.vGap + (cfg.labelRoom || 0);
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

function cubicPoint(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  const x = uuu * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + ttt * p3x;
  const y = uuu * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + ttt * p3y;
  return { x, y };
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
    // Place label above the child box, centered horizontally
    const childLines = nodeLabel(child);
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
    // background to improve readability over edges/nodes
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
    // put bg behind text
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

export function renderGraph(svg, obj, opts = {}) {
  if (!svg) return;
  // labelGap keeps label close to its own box; labelRoom adds extra space between sibling boxes so labels don't overlap previous boxes
  const cfg = { nodeWidth: 180, nodeVPad: 10, lineHeight: 16, xGap: 260, vGap: 16, labelGap: 6, labelRoom: 14 };
  let root = buildTree(obj);

  // If root is an object with a single key, start from that child so the first box shows that key (e.g., 'glossary')
  if (opts.startAtSingleChild !== false && root.type === 'object' && root.children.length === 1) {
    root = root.children[0].child;
  }

  const allById = new Map(collectNodes(root).map(n => [n.id, n]));
  const expanded = new Set(); // collapsed by default

  function rerender() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    measureLayout(root, cfg, expanded);
    layout(root, cfg, 20, 20, expanded);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    // Draw edges only from expanded parents
    (function drawVisibleEdges(n){
      if (expanded.has(n.id)) {
        for (const e of n.children) {
          drawEdge(g, n, e.child, e.edge, cfg);
          drawVisibleEdges(e.child);
        }
      }
    })(root);

    // Draw nodes that are visible
    const nodes = visibleNodes(root, expanded);
    for (const n of nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-id', String(n.id));
      // draw node into this temp group
      drawNode(group, n, cfg);
      // clickable toggle for nodes with children
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

    // Fit SVG size to content
    const maxX = Math.max(...nodes.map(n => n.x)) + cfg.nodeWidth + 20;
    const maxY = Math.max(...nodes.map(n => n.y)) + 20;
    svg.setAttribute('viewBox', `0 0 ${Math.ceil(maxX)} ${Math.ceil(maxY)}`);
    svg.setAttribute('width', String(Math.ceil(maxX)));
    svg.setAttribute('height', String(Math.ceil(maxY)));
  }

  // initial paint (only one box visible)
  rerender();

  // Attach controller to the SVG for external control (expand/collapse all)
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





