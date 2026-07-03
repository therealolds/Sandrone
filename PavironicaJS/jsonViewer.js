// JSON Viewer helpers (ES module)
// - formatJson: pretty-print JSON
// - renderTree: render interactive collapsible JSON tree
//   (Alt+click on a node toggle expands/collapses its whole subtree)

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

function formatPath(segments) {
  const safe = Array.isArray(segments) ? segments : [];
  if (!safe.length) return 'root>';
  return `root>${safe.map((s) => String(s)).join('>')}>`;
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

function createScalar(value, key, pathSegments) {
  const line = document.createElement('div');
  line.className = 'line';
  // For array scalar items, show the parent container path (requested UX).
  const pathForLine = (key === undefined && Array.isArray(pathSegments) && pathSegments.length > 0)
    ? pathSegments.slice(0, -1)
    : pathSegments;
  line.dataset.path = formatPath(pathForLine);
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

function createNode(value, key, pathSegments = []) {
  const node = document.createElement('div');
  node.className = 'node';

  const isArray = Array.isArray(value);
  const isObj = value && typeof value === 'object' && !isArray;

  if (!isArray && !isObj) {
    node.appendChild(createScalar(value, key, pathSegments));
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
  line.dataset.path = formatPath(pathSegments);
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  toggle.title = 'Collapse/Expand (Alt+click: whole subtree)';
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
        const child = createNode(val, undefined, pathSegments.concat(idx));
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
        const child = createNode(value[k], k, pathSegments.concat(k));
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
    if (e.altKey) {
      if (collapsed) expandNodeRecursive(node); else collapseNodeRecursive(node);
      return;
    }
    setCollapsed(node, !collapsed);
  });

  return node;
}

export function renderTree(container, obj) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(createNode(obj, undefined, []));
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

export default { formatJson, renderTree, expandAll, collapseAll };
