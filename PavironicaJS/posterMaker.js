// Poster Maker: take one image (e.g. a screenshot of a print you're thinking of buying),
// set its real-world size in cm, and slice it into printable sheets you can print at 1:1
// scale and tape together into a full-size poster / wall preview.
//
// All processing happens client-side using Canvas. Nothing is uploaded.

const CM_PER_INCH = 2.54;

// Given a total length in cm and the printable length of a single A4 sheet (already
// reduced by the margins), return the tiles needed to cover it. Adjacent tiles share
// `overlapCm` of image so they are easy to line up on the wall.
export function computeTiles(totalCm, printableCm, overlapCm) {
  const tiles = [];
  const step = printableCm - overlapCm;
  if (step <= 0) throw new Error('Overlap is too large for the sheet size.');
  let start = 0;
  // Guard against pathological inputs producing thousands of tiles.
  while (start < totalCm - 1e-6 && tiles.length < 500) {
    const size = Math.min(printableCm, totalCm - start);
    tiles.push({ start, size });
    if (start + size >= totalCm - 1e-6) break;
    start += step;
  }
  return tiles;
}

// Draw the source image onto a canvas of the exact target pixel size, applying the
// chosen fit mode. Returns the canvas.
function renderFullCanvas(img, fullWpx, fullHpx, fitMode) {
  const canvas = document.createElement('canvas');
  canvas.width = fullWpx;
  canvas.height = fullHpx;
  const ctx = canvas.getContext('2d');

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const targetRatio = fullWpx / fullHpx;
  const imgRatio = iw / ih;

  if (fitMode === 'stretch') {
    ctx.drawImage(img, 0, 0, fullWpx, fullHpx);
  } else if (fitMode === 'contain') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, fullWpx, fullHpx);
    let dw, dh;
    if (imgRatio > targetRatio) { dw = fullWpx; dh = dw / imgRatio; }
    else { dh = fullHpx; dw = dh * imgRatio; }
    ctx.drawImage(img, (fullWpx - dw) / 2, (fullHpx - dh) / 2, dw, dh);
  } else { // cover: fill the whole area, cropping the overflow
    let sw, sh, sx, sy;
    if (imgRatio > targetRatio) { sh = ih; sw = sh * targetRatio; sy = 0; sx = (iw - sw) / 2; }
    else { sw = iw; sh = sw / targetRatio; sx = 0; sy = (ih - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, fullWpx, fullHpx);
  }
  return canvas;
}

// Slice an image into A4-sized tiles.
//
// Options:
//   widthCm, heightCm   : real-world size of the print
//   paperWCm, paperHCm  : size of a single output sheet (defaults to A4 portrait)
//   marginCm            : unprintable safety margin on each side of the sheet
//   overlapCm           : image shared between adjacent tiles, for alignment
//   fitMode             : 'cover' | 'contain' | 'stretch'
//   dpi                 : output resolution
//
// Returns { cols, rows, sheets, widthCm, heightCm, paperWCm, paperHCm, marginCm, tiles },
// where each tile is { row, col, label, widthCm, heightCm, dataUrl }.
export function buildTiles(img, {
  widthCm, heightCm, paperWCm = 21, paperHCm = 29.7,
  marginCm = 1, overlapCm = 1, fitMode = 'cover', dpi = 150,
} = {}) {
  if (!img) throw new Error('No image provided.');
  if (!(widthCm > 0) || !(heightCm > 0)) throw new Error('Enter a valid width and height in cm.');
  if (!(paperWCm > 0) || !(paperHCm > 0)) throw new Error('Enter a valid paper size in cm.');

  const printableW = paperWCm - 2 * marginCm;
  const printableH = paperHCm - 2 * marginCm;
  if (printableW <= overlapCm || printableH <= overlapCm) {
    throw new Error('Margin and overlap are too large for the chosen paper size.');
  }

  const pxPerCm = dpi / CM_PER_INCH;
  const fullWpx = Math.max(1, Math.round(widthCm * pxPerCm));
  const fullHpx = Math.max(1, Math.round(heightCm * pxPerCm));

  const fullCanvas = renderFullCanvas(img, fullWpx, fullHpx, fitMode);

  const colTiles = computeTiles(widthCm, printableW, overlapCm);
  const rowTiles = computeTiles(heightCm, printableH, overlapCm);

  const tiles = [];
  rowTiles.forEach((rt, r) => {
    colTiles.forEach((ct, c) => {
      const sxPx = Math.round(ct.start * pxPerCm);
      const syPx = Math.round(rt.start * pxPerCm);
      const swPx = Math.max(1, Math.round(ct.size * pxPerCm));
      const shPx = Math.max(1, Math.round(rt.size * pxPerCm));

      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = swPx;
      tileCanvas.height = shPx;
      const tctx = tileCanvas.getContext('2d');
      tctx.drawImage(fullCanvas, sxPx, syPx, swPx, shPx, 0, 0, swPx, shPx);

      tiles.push({
        row: r,
        col: c,
        label: `R${r + 1}C${c + 1}`,
        widthCm: ct.size,
        heightCm: rt.size,
        dataUrl: tileCanvas.toDataURL('image/jpeg', 0.92),
      });
    });
  });

  return {
    cols: colTiles.length,
    rows: rowTiles.length,
    sheets: colTiles.length * rowTiles.length,
    widthCm,
    heightCm,
    paperWCm,
    paperHCm,
    marginCm,
    tiles,
  };
}

// Load an image from a File/Blob (file picker, drag & drop, or clipboard paste).
// Resolves to an HTMLImageElement plus a data URL for previewing.
export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) { reject(new Error('No image received.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error("That file doesn't look like a valid image."));
      img.onload = () => resolve({ img, dataUrl });
      img.src = dataUrl;
    };
    reader.readAsDataURL(blob);
  });
}
