// Markdown -> printable A5 booklet, imposed on A4 landscape sheets.
//
// Port of the logic in the user-supplied `canzoniere_libretto.py`: paginate a
// document at A5 size, then impose the pages onto A4-landscape sheets so that,
// once printed double-sided, folded in half along the short edge, and stapled,
// the pages read in the correct order as an A5 booklet.
//
// Everything runs client-side: a tiny hand-written PDF serializer (pdfLite.js,
// standard 14 fonts only, no embedding) plus Canvas 2D text metrics for word
// wrapping. No upload, no external libraries.
//
// Markdown support is intentionally simple (this is a booklet layout tool, not
// a full Markdown renderer):
//   # / ## / ### headings   -> section titles (an H1 starts a new page)
//   - item / * item / 1. i  -> bullet lines
//   --- (3+ - or * or _)    -> forced page break
//   blank line              -> paragraph/stanza break
// Every other line is kept as its own line (wrapped only if it doesn't fit the
// page width) rather than reflowed into a single block — this preserves manual
// line breaks, which matters for lyrics, poems and lists.
// Inline emphasis markers (**bold**, *italic*, `code`) are stripped, not styled.
// Supported characters: Latin-1 (accented Italian/English/etc.) plus common
// "smart" punctuation. Anything else (emoji, CJK, ...) renders as "?".

import { textOp, ruleOp, translatedBlock, buildPdf } from './pdfLite.js';

const MM = 72 / 25.4;
export const A5_W = 148.5 * MM;
export const A5_H = 210 * MM;
export const A4L_W = 297 * MM;
export const A4L_H = 210 * MM;

const MARGIN_TOP = 14 * MM;
const MARGIN_BOTTOM = 15 * MM;
const MARGIN_LEFT = 12 * MM;
const MARGIN_RIGHT = 12 * MM;
const CONTENT_W = A5_W - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_TOP_Y = A5_H - MARGIN_TOP;

const HEADING_STYLE = {
  h1: { font: 'F5', size: 19, lineH: 22, ruleGap: 5, afterGap: 9 },
  h2: { font: 'F2', size: 13, lineH: 16, before: 9, afterGap: 5 },
  h3: { font: 'F2', size: 11.5, lineH: 14.5, before: 7, afterGap: 4 },
};

function baselineY(topY, size) {
  return topY - size * 0.82;
}

// ---------------------------------------------------------------------------
// markdown parsing
// ---------------------------------------------------------------------------
function cleanInline(s) {
  return s
    .replace(/\\([\\`*_{}[\]()#+.!>~-])/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function parseMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    let m;
    if (trimmed === '') {
      blocks.push({ type: 'blank' });
    } else if ((m = /^#\s+(.+)$/.exec(trimmed))) {
      blocks.push({ type: 'h1', text: cleanInline(m[1]) });
    } else if ((m = /^##\s+(.+)$/.exec(trimmed))) {
      blocks.push({ type: 'h2', text: cleanInline(m[1]) });
    } else if ((m = /^###\s+(.+)$/.exec(trimmed))) {
      blocks.push({ type: 'h3', text: cleanInline(m[1]) });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
    } else if ((m = /^[-*]\s+(.+)$/.exec(trimmed))) {
      blocks.push({ type: 'li', text: cleanInline(m[1]) });
    } else if ((m = /^\d+\.\s+(.+)$/.exec(trimmed))) {
      blocks.push({ type: 'li', text: cleanInline(m[1]) });
    } else {
      blocks.push({ type: 'p', text: cleanInline(trimmed) });
    }
  }
  // collapse consecutive blank lines and trim leading/trailing ones
  const out = [];
  for (const b of blocks) {
    if (b.type === 'blank' && (out.length === 0 || out[out.length - 1].type === 'blank')) continue;
    out.push(b);
  }
  while (out.length && out[out.length - 1].type === 'blank') out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// text measurement (Canvas 2D standing in for the base-14 PDF font metrics —
// Arial/Times New Roman are metric-compatible with Helvetica/Times-Roman)
// ---------------------------------------------------------------------------
let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}
const CSS_FONT = {
  F1: '400 SIZEpx Arial, Helvetica, sans-serif',
  F2: '700 SIZEpx Arial, Helvetica, sans-serif',
  F3: 'italic 400 SIZEpx Arial, Helvetica, sans-serif',
  F4: '400 SIZEpx "Times New Roman", Times, serif',
  F5: '700 SIZEpx "Times New Roman", Times, serif',
  F6: 'italic 400 SIZEpx "Times New Roman", Times, serif',
};

function textWidth(text, fontTag, sizePt) {
  const ctx = getMeasureCtx();
  ctx.font = (CSS_FONT[fontTag] || CSS_FONT.F1).replace('SIZE', sizePt);
  return ctx.measureText(text).width;
}

function wrapText(text, fontTag, sizePt, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const measure = (t) => textWidth(t, fontTag, sizePt);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? cur + ' ' + word : word;
    if (!cur || measure(candidate) <= maxWidth) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
    }
    while (cur.length > 1 && measure(cur) > maxWidth) {
      let lo = 1, hi = cur.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measure(cur.slice(0, mid)) <= maxWidth) lo = mid; else hi = mid - 1;
      }
      lines.push(cur.slice(0, lo));
      cur = cur.slice(lo);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function truncateToWidth(text, fontTag, sizePt, maxWidth) {
  if (textWidth(text, fontTag, sizePt) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(text.slice(0, mid) + '…', fontTag, sizePt) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

// ---------------------------------------------------------------------------
// body pagination
// ---------------------------------------------------------------------------
function layoutBody(blocks, opts) {
  const bodySize = opts.bodySize;
  const bodyLineH = bodySize * 1.32;
  const paraGap = bodySize * 0.55;
  const pages = [];
  let content = '';
  let headings = [];
  let cursorY = CONTENT_TOP_Y;
  let firstOnPage = true;

  function finishPage() {
    pages.push({ content, headings });
    content = '';
    headings = [];
    cursorY = CONTENT_TOP_Y;
    firstOnPage = true;
  }
  function ensureRoom(h) {
    if (cursorY - h < MARGIN_BOTTOM) finishPage();
  }

  for (const block of blocks) {
    if (block.type === 'blank') {
      cursorY -= paraGap;
      continue;
    }
    if (block.type === 'hr') {
      if (!firstOnPage) finishPage();
      continue;
    }
    if (block.type === 'h1') {
      if (opts.pageBreakOnH1 && !firstOnPage) finishPage();
      const st = HEADING_STYLE.h1;
      ensureRoom(st.lineH + st.ruleGap + st.afterGap);
      content += textOp(st.font, st.size, MARGIN_LEFT, baselineY(cursorY, st.size), block.text, [0.07, 0.07, 0.07]);
      cursorY -= st.lineH;
      content += ruleOp(MARGIN_LEFT, cursorY + st.ruleGap, A5_W - MARGIN_RIGHT);
      cursorY -= st.afterGap;
      headings.push({ text: block.text });
      firstOnPage = false;
      continue;
    }
    if (block.type === 'h2' || block.type === 'h3') {
      const st = HEADING_STYLE[block.type];
      ensureRoom(st.before + st.lineH + st.afterGap);
      cursorY -= st.before;
      content += textOp(st.font, st.size, MARGIN_LEFT, baselineY(cursorY, st.size), block.text, [0.1, 0.1, 0.1]);
      cursorY -= st.lineH + st.afterGap;
      firstOnPage = false;
      continue;
    }
    // 'p' or 'li'
    const isLi = block.type === 'li';
    const indent = isLi ? 11 : 0;
    const maxWidth = CONTENT_W - indent;
    const lines = wrapText(block.text, 'F1', bodySize, maxWidth);
    const blockHeight = lines.length * bodyLineH;
    const fullPageUsable = CONTENT_TOP_Y - MARGIN_BOTTOM;
    if (!firstOnPage && blockHeight <= fullPageUsable && cursorY - blockHeight < MARGIN_BOTTOM) {
      finishPage();
    }
    lines.forEach((line, i) => {
      ensureRoom(bodyLineH);
      if (isLi && i === 0) {
        content += textOp('F1', bodySize, MARGIN_LEFT, baselineY(cursorY, bodySize), '•', [0.2, 0.2, 0.2]);
      }
      content += textOp('F1', bodySize, MARGIN_LEFT + indent, baselineY(cursorY, bodySize), line, [0.07, 0.07, 0.07]);
      cursorY -= bodyLineH;
    });
    cursorY -= paraGap;
    firstOnPage = false;
  }
  if (content || pages.length === 0) pages.push({ content, headings });
  return pages;
}

// ---------------------------------------------------------------------------
// cover + table of contents
// ---------------------------------------------------------------------------
function centerX(text, fontTag, size) {
  return (A5_W - textWidth(text, fontTag, size)) / 2;
}

function buildCoverPage(title, pageCount) {
  let content = '';
  const size = 28;
  content += textOp('F5', size, centerX(title, 'F5', size), A5_H - 92 * MM, title, [0.07, 0.07, 0.07]);
  content += ruleOp(A5_W / 2 - 22 * MM, A5_H - 100 * MM, A5_W / 2 + 22 * MM, 0.8, [0.2, 0.2, 0.2]);
  const sub = `${pageCount} PAGIN${pageCount === 1 ? 'A' : 'E'}`;
  content += textOp('F1', 10.5, centerX(sub, 'F1', 10.5), A5_H - 112 * MM, sub, [0.45, 0.45, 0.45]);
  return content;
}

function buildTocPages(entries) {
  const size = 9.5;
  const lineH = size * 1.55;
  const gutter = textWidth('999', 'F1', size) + 4; // fixed reservation: TOC page count must not
  const maxTitleWidth = CONTENT_W - gutter;         // depend on the actual (not-yet-known) page numbers
  const pages = [];
  let content = '';
  let cursorY = CONTENT_TOP_Y;
  content += textOp('F5', 16, MARGIN_LEFT, baselineY(cursorY, 16), 'Indice', [0.07, 0.07, 0.07]);
  cursorY -= 16 * 1.15;
  content += ruleOp(MARGIN_LEFT, cursorY + 3, A5_W - MARGIN_RIGHT);
  cursorY -= 10;
  for (const e of entries) {
    if (cursorY - lineH < MARGIN_BOTTOM) {
      pages.push(content);
      content = '';
      cursorY = CONTENT_TOP_Y;
    }
    const title = truncateToWidth(e.title, 'F1', size, maxTitleWidth);
    const label = String(e.page);
    const labelW = textWidth(label, 'F1', size);
    content += textOp('F1', size, MARGIN_LEFT, baselineY(cursorY, size), title, [0.15, 0.15, 0.15]);
    content += textOp('F1', size, A5_W - MARGIN_RIGHT - labelW, baselineY(cursorY, size), label, [0.4, 0.4, 0.4]);
    cursorY -= lineH;
  }
  pages.push(content);
  return pages;
}

// ---------------------------------------------------------------------------
// saddle-stitch imposition (mirrors impose() in canzoniere_libretto.py)
// ---------------------------------------------------------------------------
function impose(pageContents, signature) {
  const pages = pageContents.slice();
  while (pages.length % 4 !== 0) pages.push('');
  const total = pages.length;
  const sig = signature || total;
  const sheets = [];
  for (let base = 0; base < total; base += sig) {
    const chunk = pages.slice(base, base + sig);
    const m = chunk.length;
    for (let k = 0; k < Math.floor(m / 4); k++) {
      const front = translatedBlock(chunk[m - 1 - 2 * k], 0, 0) + translatedBlock(chunk[2 * k], A5_W, 0);
      sheets.push({ width: A4L_W, height: A4L_H, content: front });
      const back = translatedBlock(chunk[2 * k + 1], 0, 0) + translatedBlock(chunk[m - 2 - 2 * k], A5_W, 0);
      sheets.push({ width: A4L_W, height: A4L_H, content: back });
    }
  }
  return { sheets, total };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
    reader.readAsText(file, 'utf-8');
  });
}

export function generateBooklet(markdownText, options = {}) {
  const opts = {
    title: (options.title || 'Documento').trim() || 'Documento',
    bodySize: Math.min(14, Math.max(7, Number(options.bodySize) || 10.5)),
    pageBreakOnH1: options.pageBreakOnH1 !== false,
    includeToc: options.includeToc !== false,
    includeCover: options.includeCover !== false,
    signature: options.signature ? Number(options.signature) : null,
  };
  if (opts.signature != null && (opts.signature % 4 !== 0 || opts.signature < 4)) {
    throw new Error('La dimensione del fascicolo deve essere un multiplo di 4 (es. 16, 32...).');
  }

  const blocks = parseMarkdown(markdownText);
  if (!blocks.length) throw new Error('Nessun contenuto trovato nel file markdown.');

  const bodyPages = layoutBody(blocks, opts);

  const h1Entries = [];
  bodyPages.forEach((p, i) => {
    for (const h of p.headings) h1Entries.push({ title: h.text, relPage: i + 1 });
  });

  const coverPages = opts.includeCover ? [buildCoverPage(opts.title, bodyPages.length)] : [];

  let tocPages = [];
  if (opts.includeToc && h1Entries.length) {
    const provisional = buildTocPages(h1Entries.map((e) => ({ title: e.title, page: e.relPage })));
    const offset = coverPages.length + provisional.length;
    tocPages = buildTocPages(h1Entries.map((e) => ({ title: e.title, page: e.relPage + offset })));
  }

  const flatContents = [...coverPages, ...tocPages, ...bodyPages.map((p) => p.content)];

  const numberedContents = flatContents.map((content, idx) => {
    if (opts.includeCover && idx === 0) return content; // no folio on the cover
    const label = String(idx + 1);
    const w = textWidth(label, 'F1', 8);
    return content + textOp('F1', 8, A5_W / 2 - w / 2, 8 * MM, label, [0.53, 0.53, 0.53]);
  });

  const a5Pages = numberedContents.map((content) => ({ width: A5_W, height: A5_H, content }));
  const a5Bytes = buildPdf(a5Pages);

  const { sheets, total } = impose(numberedContents, opts.signature);
  const a4Bytes = buildPdf(sheets);

  return {
    a5Bytes,
    a4Bytes,
    pageCount: numberedContents.length,
    imposedPageCount: total,
    sheetCount: sheets.length / 2,
    headingCount: h1Entries.length,
  };
}
