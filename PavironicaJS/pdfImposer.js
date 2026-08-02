// Impose an existing PDF into a saddle-stitch A5 booklet on A4-landscape sheets.
//
// Complements mdBooklet.js: instead of laying out markdown, this takes a PDF the
// user already has (A4, A5, or any size — including one with images) and arranges
// its pages two-up on A4-landscape sheets so that, printed double-sided (flip on
// the short edge), folded in half and stapled, they read in the correct order.
//
// Parsing/embedding a real-world PDF (compressed streams, images, fonts, xref
// streams) is not something the hand-rolled pdfLite.js can do, so this module
// relies on pdf-lib, vendored locally at assets/vendor/pdf-lib.min.js and loaded
// as a global (window.PDFLib) by the HTML page. Everything still runs in the
// browser: the file is never uploaded.
//
// The imposition order is identical to impose() in mdBooklet.js / the original
// canzoniere_libretto.py. Each source page is scaled to fit an A5 half of the
// sheet, preserving aspect ratio and centered, so both A4 and A5 (and odd sizes)
// inputs work; A4 pages simply come out at 71% (A5 is half of A4).

const MM = 72 / 25.4;
const A5_W = 148.5 * MM;
const A5_H = 210 * MM;
const A4L_W = 297 * MM;
const A4L_H = 210 * MM;

function getPDFLib() {
  const lib = (typeof window !== 'undefined') ? window.PDFLib : undefined;
  if (!lib || !lib.PDFDocument) {
    throw new Error('Libreria PDF non caricata. Ricarica la pagina e riprova.');
  }
  return lib;
}

// Effective on-screen size of a page, accounting for 90°/270° rotation.
function effectiveSize(embedded, rotationDegrees) {
  const rot = ((rotationDegrees % 360) + 360) % 360;
  if (rot === 90 || rot === 270) return { w: embedded.height, h: embedded.width };
  return { w: embedded.width, h: embedded.height };
}

/**
 * @param {ArrayBuffer|Uint8Array} srcBytes  the source PDF
 * @param {object} options  { signature?: number|null }
 * @returns {Promise<{bytes: Uint8Array, sourcePageCount, imposedPageCount, sheetCount}>}
 */
export async function imposePdf(srcBytes, options = {}) {
  const { PDFDocument } = getPDFLib();

  const signature = options.signature ? Number(options.signature) : null;
  if (signature != null && (signature % 4 !== 0 || signature < 4)) {
    throw new Error('La dimensione del fascicolo deve essere un multiplo di 4 (es. 16, 32...).');
  }

  let src;
  try {
    src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  } catch (e) {
    throw new Error('Impossibile leggere il PDF: il file è danneggiato o protetto.');
  }
  const sourcePageCount = src.getPageCount();
  if (!sourcePageCount) throw new Error('Il PDF non contiene pagine.');

  const out = await PDFDocument.create();
  const indices = Array.from({ length: sourcePageCount }, (_, i) => i);
  const embedded = await out.embedPdf(src, indices);
  // Rotation of each source page (pdf-lib bakes the page content but reports the
  // /Rotate value, which we use to swap width/height for correct scaling).
  const rotations = src.getPages().map((p) => {
    try { return p.getRotation().angle || 0; } catch (_) { return 0; }
  });

  // Pad to a multiple of 4 with blank half-sheets.
  const order = embedded.map((emb, i) => ({ emb, rot: rotations[i] }));
  while (order.length % 4 !== 0) order.push(null);
  const total = order.length;
  const sig = signature || total;

  function place(sheet, item, leftHalf) {
    if (!item) return; // blank half
    const { w, h } = effectiveSize(item.emb, item.rot);
    const k = Math.min(A5_W / w, A5_H / h);
    const tx = (leftHalf ? 0 : A5_W) + (A5_W - w * k) / 2;
    const ty = (A4L_H - h * k) / 2;
    sheet.drawPage(item.emb, { x: tx, y: ty, xScale: k, yScale: k });
  }

  for (let base = 0; base < total; base += sig) {
    const chunk = order.slice(base, base + sig);
    const m = chunk.length;
    for (let k = 0; k < Math.floor(m / 4); k++) {
      const front = out.addPage([A4L_W, A4L_H]);
      place(front, chunk[m - 1 - 2 * k], true);
      place(front, chunk[2 * k], false);
      const back = out.addPage([A4L_W, A4L_H]);
      place(back, chunk[2 * k + 1], true);
      place(back, chunk[m - 2 - 2 * k], false);
    }
  }

  const bytes = await out.save();
  return {
    bytes,
    sourcePageCount,
    imposedPageCount: total,   // A5 page slots, including blank padding
    sheetCount: total / 4,     // physical A4 sheets (each holds 4 A5 pages, printed double-sided)
  };
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
    reader.readAsArrayBuffer(file);
  });
}
