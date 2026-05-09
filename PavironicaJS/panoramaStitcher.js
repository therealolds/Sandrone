// Panorama Stitcher: translation-based alignment via NCC on downsampled thumbnails,
// then feather-blend at full resolution. All processing is client-side.

const THUMB_MAX = 256;

function isHeic(file) {
  return /\.hei[cf]$/i.test(file.name) ||
    file.type === 'image/heic' || file.type === 'image/heif';
}

// heic2any@0.0.4 bundles libheif v1.3 (2019) which does not include HEVC/H.265
// support in its WASM build — exactly the codec iPhones use. We use libheif-js
// v1.17.x directly: it ships with libde265 (open-source HEVC decoder) and
// handles modern iPhone HEIC files correctly.
let _libheifPromise = null;
let _libheif        = null;

async function ensureLibheif() {
  if (_libheif) return _libheif;
  if (!_libheifPromise) {
    _libheifPromise = new Promise((resolve, reject) => {
      // Snapshot current globals so we can detect what the UMD script adds.
      const snapshot = new Set(Object.keys(window));
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/libheif-js@1.17.1/libheif-wasm/libheif-web.js';
      s.onload = () => {
        // libheif-js exposes its API as window.libheif in UMD mode;
        // fall back to scanning new globals for a HeifDecoder class.
        const lib = window.libheif ||
          Object.keys(window)
            .filter(k => !snapshot.has(k))
            .map(k => window[k])
            .find(v => v && typeof v.HeifDecoder === 'function');
        if (lib) resolve(lib);
        else reject(new Error('HEIC decoder loaded but HeifDecoder not found.'));
      };
      s.onerror = () => reject(new Error(
        'Could not load the HEIC decoder library. ' +
        'Check your internet connection, or convert the files to JPEG/PNG first.'
      ));
      document.head.appendChild(s);
    });
  }
  _libheif = await _libheifPromise;
  return _libheif;
}

async function decodeHeicWithLibheif(file) {
  const lib = await ensureLibheif();
  const buf = await file.arrayBuffer();
  const decoder = new lib.HeifDecoder();
  const images  = decoder.decode(new Uint8Array(buf));
  if (!images || images.length === 0) throw new Error('No images found in HEIC file.');

  const img = images[0];
  const w   = img.get_width();
  const h   = img.get_height();

  const displayData = await new Promise((resolve, reject) => {
    img.display(
      { data: new Uint8ClampedArray(4 * w * h), width: w, height: h },
      (result) => result ? resolve(result) : reject(new Error('Failed to render HEIC image.'))
    );
  });

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(displayData.data, w, h), 0, 0);
  return typeof createImageBitmap !== 'undefined' ? createImageBitmap(canvas) : canvas;
}

async function loadViaImg(source) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to decode image')); };
    img.src = url;
  });
}

/**
 * Loads any image file (JPEG, PNG, HEIC/HEIF) as an ImageBitmap or HTMLImageElement.
 * Safari decodes HEIC natively; other browsers use libheif-js (lazy, CDN).
 * Exported so the HTML page can reuse it for thumbnail previews.
 */
export async function loadImageFile(file) {
  // 1 — Try native decode (works for JPEG/PNG everywhere; HEIC on Safari)
  if (typeof createImageBitmap !== 'undefined') {
    try { return await createImageBitmap(file); } catch (_) {}
  }
  try { return await loadViaImg(file); } catch (_) {
    if (!isHeic(file)) throw new Error(`Failed to load ${file.name}`);
  }

  // 2 — HEIC on non-Safari: decode via libheif-js (includes HEVC via libde265)
  return decodeHeicWithLibheif(file);
}

function bmpSize(bmp) {
  return { w: bmp.width ?? bmp.naturalWidth, h: bmp.height ?? bmp.naturalHeight };
}

function downsample(bmp, maxDim) {
  const { w, h } = bmpSize(bmp);
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, tw, th);
  return { imgData: ctx.getImageData(0, 0, tw, th), w: tw, h: th, scale };
}

function toGray(imgData) {
  const { data, width, height } = imgData;
  const g = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return g;
}

// Normalized cross-correlation score for placing gray2 at offset (dx, dy) in gray1's space.
// Returns value in [-1, 1]; -2 means the overlap is too small to be meaningful.
function ncc(gray1, w1, h1, gray2, w2, h2, dx, dy) {
  const x1s = Math.max(0, dx), x1e = Math.min(w1, dx + w2);
  const y1s = Math.max(0, dy), y1e = Math.min(h1, dy + h2);
  if (x1e - x1s < 8 || y1e - y1s < 8) return -2;

  const cols = x1e - x1s, rows = y1e - y1s;
  const x2s = x1s - dx, y2s = y1s - dy;
  const n = cols * rows;

  let s1 = 0, s2 = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      s1 += gray1[(y1s + r) * w1 + (x1s + c)];
      s2 += gray2[(y2s + r) * w2 + (x2s + c)];
    }
  }
  const m1 = s1 / n, m2 = s2 / n;

  let num = 0, sq1 = 0, sq2 = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d1 = gray1[(y1s + r) * w1 + (x1s + c)] - m1;
      const d2 = gray2[(y2s + r) * w2 + (x2s + c)] - m2;
      num += d1 * d2;
      sq1 += d1 * d1;
      sq2 += d2 * d2;
    }
  }
  const denom = Math.sqrt(sq1 * sq2);
  return denom < 1e-6 ? 0 : num / denom;
}

// Two-pass coarse+fine NCC search. Returns the (dx, dy) offset that places gray2
// optimally relative to gray1, plus the best NCC score.
function findOffset(gray1, w1, h1, gray2, w2, h2, direction, overlapFrac) {
  const ovMin = direction === 'horizontal' ? Math.min(w1, w2) : Math.min(h1, h2);
  const ovSecMin = direction === 'horizontal' ? Math.min(h1, h2) : Math.min(w1, w2);
  const overlapPx = Math.round(ovMin * overlapFrac);

  const eDx = direction === 'horizontal' ? (w1 - overlapPx) : 0;
  const eDy = direction === 'vertical' ? (h1 - overlapPx) : 0;

  // Search ±30% of overlap in primary direction, ±5% of secondary dimension
  const prRange = Math.max(3, Math.round(overlapPx * 0.3));
  const secRange = Math.max(3, Math.round(ovSecMin * 0.05));

  const dxMin = eDx - (direction === 'horizontal' ? prRange : secRange);
  const dxMax = eDx + (direction === 'horizontal' ? prRange : secRange);
  const dyMin = eDy - (direction === 'vertical' ? prRange : secRange);
  const dyMax = eDy + (direction === 'vertical' ? prRange : secRange);

  // Coarse pass (step 3)
  let best = -2, bDx = eDx, bDy = eDy;
  for (let dy = dyMin; dy <= dyMax; dy += 3) {
    for (let dx = dxMin; dx <= dxMax; dx += 3) {
      const s = ncc(gray1, w1, h1, gray2, w2, h2, dx, dy);
      if (s > best) { best = s; bDx = dx; bDy = dy; }
    }
  }

  // Fine pass (step 1, within ±4 of coarse best)
  for (let dy = bDy - 4; dy <= bDy + 4; dy++) {
    for (let dx = bDx - 4; dx <= bDx + 4; dx++) {
      const s = ncc(gray1, w1, h1, gray2, w2, h2, dx, dy);
      if (s > best) { best = s; bDx = dx; bDy = dy; }
    }
  }

  return { dx: bDx, dy: bDy, score: best };
}

/**
 * Stitches an ordered array of image Files into a panorama.
 *
 * @param {File[]} files      - Ordered image files (left→right or top→bottom)
 * @param {'horizontal'|'vertical'} direction
 * @param {number} overlapFraction - Expected fractional overlap between consecutive images (0.05–0.7)
 * @param {function} onProgress    - Optional callback(message: string)
 * @returns {Promise<{canvas: HTMLCanvasElement, scores: number[], offsets: {x,y}[]}>}
 */
export async function computePanorama(files, direction = 'horizontal', overlapFraction = 0.3, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  if (!files || files.length < 2) throw new Error('Select at least 2 images.');

  report('Loading images…');
  const bitmaps = await Promise.all(Array.from(files).map(loadImageFile));

  report('Downsampling for alignment…');
  const thumbs = bitmaps.map(b => downsample(b, THUMB_MAX));
  const grays  = thumbs.map(t => toGray(t.imgData));

  // Accumulate absolute output positions of each image
  const offsets = [{ x: 0, y: 0 }];
  const scores  = [];

  for (let i = 1; i < bitmaps.length; i++) {
    report(`Aligning image ${i + 1} / ${bitmaps.length}…`);
    const t1 = thumbs[i - 1], t2 = thumbs[i];
    const { dx: tdx, dy: tdy, score } = findOffset(
      grays[i - 1], t1.w, t1.h,
      grays[i],     t2.w, t2.h,
      direction, overlapFraction
    );
    scores.push(score);

    // Scale thumbnail offset back to full-res using the source image's own scale
    const { w: fw1, h: fh1 } = bmpSize(bitmaps[i - 1]);
    const scaleX = fw1 / t1.w;
    const scaleY = fh1 / t1.h;
    const prev = offsets[i - 1];
    offsets.push({ x: prev.x + Math.round(tdx * scaleX), y: prev.y + Math.round(tdy * scaleY) });
  }

  // Compute bounding box of all placed images
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (let i = 0; i < bitmaps.length; i++) {
    const { w, h } = bmpSize(bitmaps[i]);
    minX = Math.min(minX, offsets[i].x);
    minY = Math.min(minY, offsets[i].y);
    maxX = Math.max(maxX, offsets[i].x + w);
    maxY = Math.max(maxY, offsets[i].y + h);
  }
  const totalW = maxX - minX;
  const totalH = maxY - minY;

  const MAX_DIM = 16000;
  if (totalW > MAX_DIM || totalH > MAX_DIM) {
    throw new Error(
      `Output would be ${totalW}×${totalH} px — too large for the browser canvas (max ${MAX_DIM}). ` +
      'Use fewer images or resize them before stitching.'
    );
  }

  report(`Compositing onto ${totalW}×${totalH} canvas…`);

  const out = document.createElement('canvas');
  out.width  = totalW;
  out.height = totalH;
  const ctx  = out.getContext('2d');

  // Draw the first image at full opacity
  ctx.drawImage(bitmaps[0], offsets[0].x - minX, offsets[0].y - minY);

  // Draw each subsequent image with a feather fade on its leading edge
  for (let i = 1; i < bitmaps.length; i++) {
    const bmp = bitmaps[i];
    const { w, h } = bmpSize(bmp);
    const ox = offsets[i].x - minX;
    const oy = offsets[i].y - minY;

    // Compute actual pixel overlap with the previous image in output space
    const prevBmp = bitmaps[i - 1];
    const { w: pw, h: ph } = bmpSize(prevBmp);
    const pox = offsets[i - 1].x - minX;
    const poy = offsets[i - 1].y - minY;

    const featherPx = direction === 'horizontal'
      ? Math.max(0, (pox + pw) - ox)
      : Math.max(0, (poy + ph) - oy);

    // Render image onto a temp canvas, then mask the leading edge with a gradient
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tc = tmp.getContext('2d');
    tc.drawImage(bmp, 0, 0);

    if (featherPx > 0) {
      const grad = direction === 'horizontal'
        ? tc.createLinearGradient(0, 0, featherPx, 0)
        : tc.createLinearGradient(0, 0, 0, featherPx);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      tc.globalCompositeOperation = 'destination-in';
      tc.fillStyle = grad;
      tc.fillRect(0, 0, w, h);
    }

    ctx.drawImage(tmp, ox, oy);

    if (bmp.close) bmp.close();
  }
  if (bitmaps[0].close) bitmaps[0].close();

  report('Done.');
  return { canvas: out, scores, offsets: offsets.map(o => ({ x: o.x - minX, y: o.y - minY })) };
}

/**
 * Downloads the panorama canvas as a JPEG file.
 */
export function downloadPanorama(canvas, filename = 'panorama.jpg') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Failed to encode image')); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 300);
    }, 'image/jpeg', 0.92);
  });
}
