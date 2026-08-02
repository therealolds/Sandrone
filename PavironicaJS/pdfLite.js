// pdfLite: minimal, dependency-free PDF byte-serializer.
//
// Writes plain PDF 1.4 files using only the 6 standard "base-14" text fonts
// (Helvetica/Helvetica-Bold/Helvetica-Oblique, Times-Roman/Times-Bold/Times-Italic)
// with WinAnsiEncoding, plus simple line/rule drawing. No fonts are embedded, no
// images, no external libraries: every PDF viewer ships these fonts already.
//
// Limitation: WinAnsiEncoding covers Latin-1 (accented Italian/English/French/etc.
// letters) and a handful of "smart" typographic characters (curly quotes, en/em
// dash, ellipsis, bullet). Anything outside that range (emoji, CJK, Cyrillic, ...)
// is rendered as "?" since there is no embedded Unicode font to fall back to.

const FONT_BASE = {
  F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica-Oblique',
  F4: 'Times-Roman', F5: 'Times-Bold', F6: 'Times-Italic',
};

// Unicode code point -> WinAnsi (cp1252) byte, for the common "smart" glyphs
// that differ from a direct Latin-1 pass-through.
const WINANSI_MAP = {
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x2022: 0x95,
  0x00a0: 0x20, // nbsp -> plain space
};

function fmt(n) {
  // Compact fixed-point formatting for PDF numbers (avoids exponent notation).
  return (Math.round(n * 1000) / 1000).toString();
}

/** Maps a JS string to WinAnsi bytes and escapes '(', ')', '\' for use inside a Tj literal. */
export function escapePdfText(str) {
  let out = '';
  for (const ch of str) {
    let code = ch.codePointAt(0);
    if (WINANSI_MAP[code] != null) code = WINANSI_MAP[code];
    if (code > 255) code = 0x3f; // unsupported glyph -> '?'
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\' + String.fromCharCode(code);
    else out += String.fromCharCode(code);
  }
  return out;
}

/** One line of text, positioned by its baseline (x, y) in PDF points from the bottom-left. */
export function textOp(fontTag, sizePt, x, y, text, color) {
  const [r, g, b] = color || [0, 0, 0];
  const esc = escapePdfText(text);
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} rg\nBT /${fontTag} ${fmt(sizePt)} Tf 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm (${esc}) Tj ET\n`;
}

/** A straight stroked line, e.g. the rule under a heading. */
export function ruleOp(x0, y, x1, lineWidth, color) {
  const [r, g, b] = color || [0.6, 0.6, 0.6];
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(lineWidth || 0.6)} w ${fmt(x0)} ${fmt(y)} m ${fmt(x1)} ${fmt(y)} l S\n`;
}

/** Wraps a content-stream fragment in a save/translate/restore block (used for imposition). */
export function translatedBlock(content, tx, ty) {
  if (!content) return '';
  return `q 1 0 0 1 ${fmt(tx)} ${fmt(ty)} cm\n${content}Q\n`;
}

/**
 * Serializes a list of same-resource pages into a PDF byte stream.
 * pages: [{ width, height, content }] — width/height in points, content a raw
 * content-stream string built from textOp/ruleOp/translatedBlock.
 */
export function buildPdf(pages) {
  const fontTags = Object.keys(FONT_BASE);
  let nextId = 1;
  const catalogId = nextId++;
  const pagesId = nextId++;
  const fontIds = {};
  const objs = [];

  for (const tag of fontTags) {
    const id = nextId++;
    fontIds[tag] = id;
    objs.push({ id, body: `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE[tag]} /Encoding /WinAnsiEncoding >>` });
  }
  const resources = `<< /Font << ${fontTags.map((t) => `/${t} ${fontIds[t]} 0 R`).join(' ')} >> >>`;

  const pageIds = [];
  for (const p of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    const stream = p.content || '';
    objs.push({ id: contentId, body: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream` });
    objs.push({
      id: pageId,
      body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(p.width)} ${fmt(p.height)}] /Resources ${resources} /Contents ${contentId} 0 R >>`,
    });
    pageIds.push(pageId);
  }

  objs.push({ id: catalogId, body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` });
  objs.push({ id: pagesId, body: `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>` });
  objs.sort((a, b) => a.id - b.id);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = new Array(objs.length + 1).fill(0);
  for (const o of objs) {
    offsets[o.id] = out.length;
    out += `${o.id} 0 obj\n${o.body}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\nendxref\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
