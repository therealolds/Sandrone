// Line Padder (ES module)
// Left-pads each line to a given width.
// Options: { fill: '0', trim: false, ignoreEmpty: true }

function padLeft(s, width, fill) {
  if (s.length >= width) return s;
  const needed = width - s.length;
  if (!fill || fill.length === 0) return s.padStart(width); // fallback
  const f = fill[0];
  // Build padding efficiently
  let pad = '';
  while (pad.length < needed) pad += f;
  if (pad.length > needed) pad = pad.slice(0, needed);
  return pad + s;
}

export function padLines(input, width, opts = {}) {
  const fill = opts.fill ?? '0';
  const trim = !!opts.trim;
  const ignoreEmpty = opts.ignoreEmpty !== false;
  const lines = (input || '').split(/\r?\n/);
  const out = [];
  for (let line of lines) {
    if (trim) line = line.trim();
    if (ignoreEmpty && line.length === 0) continue;
    out.push(padLeft(line, width, fill));
  }
  return out.join('\n');
}

export default { padLines };

