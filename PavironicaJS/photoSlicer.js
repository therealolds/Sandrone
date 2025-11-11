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

export async function sliceImageFile(file, k, { format = 'auto', quality = 0.92, square = false, align = 'center' } = {}) {
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
    let x0 = 0;
    if (w > totalW) {
      if (align === 'left') x0 = 0;
      else if (align === 'right') x0 = w - totalW;
      else x0 = Math.floor((w - totalW) / 2); // center default
    }
    const y0 = h > side ? Math.floor((h - side) / 2) : 0; // center vertically

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
  for (const p of parts) {
    const url = URL.createObjectURL(p.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return parts.length;
}
