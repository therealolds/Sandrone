// Photo Cutter: split an image horizontally into k equal parts (last gets remainder)
// All processing happens client-side using Canvas. TIFF is not reliably supported by browsers.

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'png';
}

function mimeFromChoice(choice, originalMime) {
  if (choice === 'auto') {
    if (originalMime === 'image/jpeg' || originalMime === 'image/png') return originalMime;
    return 'image/png';
  }
  if (choice === 'jpeg') return 'image/jpeg';
  if (choice === 'png') return 'image/png';
  return 'image/png';
}

async function loadImageFromFile(file) {
  // Try createImageBitmap first for performance; fall back to HTMLImageElement
  const blob = file;
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, destroy: () => bmp.close && bmp.close() };
    } catch (_) { /* fall back */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Unsupported image or failed to decode'));
      i.src = url;
    });
    return { source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, destroy: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function baseName(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('Failed to encode image'));
      else resolve(b);
    }, type, quality);
  });
}

function normalizeAlign(value) {
  const horizontals = ['left', 'center', 'right'];
  const verticals = ['top', 'middle', 'bottom'];
  if (!value) return { horiz: 'center', vert: 'middle' };
  const parts = String(value).toLowerCase().split(/[\s-]+/).filter(Boolean);
  let horiz = parts.find((p) => horizontals.includes(p));
  let vert = parts.find((p) => verticals.includes(p));
  if (!horiz && horizontals.includes(value)) horiz = value;
  if (!vert && verticals.includes(value)) vert = value;
  if (!horiz) horiz = 'center';
  if (!vert) vert = 'middle';
  return { horiz, vert };
}

function offsetWithin(full, needed, mode) {
  if (full <= needed) return 0;
  if (mode === 'left' || mode === 'top') return 0;
  if (mode === 'right' || mode === 'bottom') return full - needed;
  return Math.floor((full - needed) / 2);
}

export async function sliceImageFile(file, k, { format = 'auto', quality = 0.92, square = false, align = 'middle-center' } = {}) {
  if (!file) throw new Error('No file provided');
  k = Math.max(1, Math.floor(k || 1));

  const originalMime = (file.type || '').toLowerCase();
  // Basic guard for TIFF: browsers typically cannot decode; surface a clear message
  if (/tif(?:f)?$/.test(file.name.toLowerCase()) || originalMime === 'image/tiff') {
    // We attempt to decode; if it fails in loadImageFromFile, report a helpful error
  }

  const img = await loadImageFromFile(file);
  const w = img.width, h = img.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    img.destroy && img.destroy();
    throw new Error('Invalid image dimensions');
  }

  const outMime = mimeFromChoice(format, originalMime);
  const outExt = extFromMime(outMime);
  const nameBase = baseName(file.name);

  const results = [];
  const src = img.source;
  const tmp = document.createElement('canvas');
  const ctx = tmp.getContext('2d');

  if (square) {
    // Produce k square tiles. Choose side to fit both dimensions.
    const side = Math.min(h, Math.floor(w / k));
    if (!Number.isFinite(side) || side <= 0) {
      img.destroy && img.destroy();
      throw new Error('Image too small for requested number of square slices');
    }
    const totalW = side * k;
    const { horiz, vert } = normalizeAlign(align);
    const x0 = offsetWithin(w, totalW, horiz);
    const y0 = offsetWithin(h, side, vert);

    tmp.width = side;
    tmp.height = side;

    for (let i = 0; i < k; i++) {
      const sx = x0 + i * side;
      const sy = y0;
      ctx.clearRect(0, 0, side, side);
      ctx.drawImage(src, sx, sy, side, side, 0, 0, side, side);
      const blob = await toBlob(tmp, outMime, outMime === 'image/jpeg' ? quality : undefined);
      const filename = `${nameBase}_part${i + 1}.${outExt}`;
      results.push({ blob, filename });
    }
  } else {
    // Equal-width vertical slices across full height
    const sliceW = Math.floor(w / k);
    tmp.height = h;
    for (let i = 0; i < k; i++) {
      const left = i * sliceW;
      const sw = (i === k - 1) ? (w - left) : sliceW;
      tmp.width = sw;
      ctx.clearRect(0, 0, sw, h);
      ctx.drawImage(src, left, 0, sw, h, 0, 0, sw, h);
      const blob = await toBlob(tmp, outMime, outMime === 'image/jpeg' ? quality : undefined);
      const filename = `${nameBase}_part${i + 1}.${outExt}`;
      results.push({ blob, filename });
    }
  }

  img.destroy && img.destroy();
  return results;
}

export async function sliceAndDownload(file, k, options = {}) {
  const parts = await sliceImageFile(file, k, options);

  // Safari on iOS blocks programmatic anchor clicks from async code — only the
  // last one ever fires regardless of delays. The Web Share API is the correct
  // path on touch-primary devices: it opens the native share sheet so the user
  // can save all slices to Photos or Files in one step.
  const isTouchPrimary = navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches;

  if (isTouchPrimary && typeof navigator.canShare === 'function') {
    const shareFiles = parts.map(
      p => new File([p.blob], p.filename, { type: p.blob.type })
    );
    if (navigator.canShare({ files: shareFiles })) {
      try {
        await navigator.share({ files: shareFiles });
        return parts.length;
      } catch (err) {
        if (err.name === 'AbortError') return parts.length; // user dismissed the sheet
        // share failed for another reason — fall through to anchor downloads
      }
    }
  }

  // Desktop / non-share browsers: sequential downloads with a gap so Safari
  // desktop doesn't coalesce back-to-back clicks.
  for (const p of parts) {
    const url = URL.createObjectURL(p.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise(resolve => setTimeout(resolve, 300));
    URL.revokeObjectURL(url);
  }
  return parts.length;
}
