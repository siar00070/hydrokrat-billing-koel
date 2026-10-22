// Reads an image (business card / letterhead / GST certificate) with local OCR
// and makes a best-effort guess at structured fields. Free/offline (Tesseract.js),
// so it reads text reliably but doesn't understand layout — always let the user
// review the filled fields before saving.

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Grayscale + upscale small images — a free, low-risk boost to Tesseract's accuracy.
function preprocessImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const targetWidth = 1600;
      const scale = img.width < targetWidth ? targetWidth / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Rotates the image by 0/90/180/270 degrees onto a new canvas.
function rotateImage(dataUrl, degrees) {
  if (degrees === 0) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const swap = degrees === 90 || degrees === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Lets the user drag a rectangle over the picked photo to select just the
// card/document, cropping out background clutter that badly confuses free OCR.
// Resolves the cropped image as a data URL, or null if the user cancels.
function cropImageInteractive(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 700, maxH = 480;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      const dispW = img.naturalWidth * scale;
      const dispH = img.naturalHeight * scale;

      const rect = { x: dispW * 0.08, y: dispH * 0.08, w: dispW * 0.84, h: dispH * 0.84 };

      const imgEl = el('img', { src: dataUrl, style: `display:block;width:${dispW}px;height:${dispH}px;user-select:none;-webkit-user-drag:none;` });
      const rectEl = el('div', {
        style: `position:absolute;border:2px dashed #0e3a5f;background:rgba(14,58,95,0.15);cursor:move;box-sizing:border-box;`
      });
      const handles = {};
      ['nw', 'ne', 'sw', 'se'].forEach(corner => {
        const h = el('div', {
          style: 'position:absolute;width:14px;height:14px;background:#0e3a5f;border:2px solid #fff;border-radius:50%;box-sizing:border-box;',
          'data-corner': corner
        });
        h.style.cursor = (corner === 'nw' || corner === 'se') ? 'nwse-resize' : 'nesw-resize';
        handles[corner] = h;
        rectEl.appendChild(h);
      });

      function applyRectStyle() {
        rectEl.style.left = rect.x + 'px';
        rectEl.style.top = rect.y + 'px';
        rectEl.style.width = rect.w + 'px';
        rectEl.style.height = rect.h + 'px';
        const pos = {
          nw: [-7, -7], ne: [rect.w - 7, -7], sw: [-7, rect.h - 7], se: [rect.w - 7, rect.h - 7]
        };
        Object.entries(pos).forEach(([corner, [l, t]]) => {
          handles[corner].style.left = l + 'px';
          handles[corner].style.top = t + 'px';
        });
      }
      applyRectStyle();

      function clampRect() {
        rect.w = Math.max(30, Math.min(rect.w, dispW - rect.x));
        rect.h = Math.max(30, Math.min(rect.h, dispH - rect.y));
        rect.x = Math.max(0, Math.min(rect.x, dispW - rect.w));
        rect.y = Math.max(0, Math.min(rect.y, dispH - rect.h));
      }

      let drag = null;
      rectEl.addEventListener('mousedown', (e) => {
        if (e.target !== rectEl) return;
        drag = { mode: 'move', startX: e.clientX, startY: e.clientY, orig: { ...rect } };
        e.preventDefault();
      });
      Object.entries(handles).forEach(([corner, h]) => {
        h.addEventListener('mousedown', (e) => {
          drag = { mode: 'resize', corner, startX: e.clientX, startY: e.clientY, orig: { ...rect } };
          e.preventDefault();
          e.stopPropagation();
        });
      });
      function onWindowMouseMove(e) {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (drag.mode === 'move') {
          rect.x = drag.orig.x + dx;
          rect.y = drag.orig.y + dy;
        } else {
          const o = drag.orig;
          if (drag.corner.includes('n')) { rect.y = o.y + dy; rect.h = o.h - dy; }
          if (drag.corner.includes('s')) { rect.h = o.h + dy; }
          if (drag.corner.includes('w')) { rect.x = o.x + dx; rect.w = o.w - dx; }
          if (drag.corner.includes('e')) { rect.w = o.w + dx; }
        }
        clampRect();
        applyRectStyle();
      }
      function onWindowMouseUp() { drag = null; }
      window.addEventListener('mousemove', onWindowMouseMove);
      window.addEventListener('mouseup', onWindowMouseUp);

      const imgWrap = el('div', { style: `position:relative;width:${dispW}px;height:${dispH}px;` }, [imgEl, rectEl]);

      const overlay = el('div', { class: 'modal-overlay' });
      const cleanup = (result) => {
        window.removeEventListener('mousemove', onWindowMouseMove);
        window.removeEventListener('mouseup', onWindowMouseUp);
        overlay.remove();
        resolve(result);
      };

      const box = el('div', { class: 'modal-box', style: 'width:auto;max-width:90vw;' }, [
        el('h3', {}, ['Select just the card / document']),
        el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-8px' }, ['Drag the corners to crop out the background — this makes scanning far more accurate.']),
        imgWrap,
        el('div', { class: 'btn-row', style: 'margin-top:14px' }, [
          el('button', { class: 'btn', onclick: async () => {
            const scaleX = img.naturalWidth / dispW;
            const scaleY = img.naturalHeight / dispH;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(rect.w * scaleX);
            canvas.height = Math.round(rect.h * scaleY);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, rect.x * scaleX, rect.y * scaleY, rect.w * scaleX, rect.h * scaleY, 0, 0, canvas.width, canvas.height);
            cleanup(canvas.toDataURL('image/png'));
          } }, ['Use This Area']),
          el('button', { class: 'btn secondary', onclick: () => cleanup(null) }, ['Cancel'])
        ])
      ]);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function parseOcrText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const consumed = new Set();

  const gstinRe = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]Z[A-Z0-9]\b/;
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const mobileRe = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;
  const pincodeRe = /\b\d{3}\s?\d{3}\b/;

  const gstinMatch = text.match(gstinRe);
  const emailMatch = text.match(emailRe);
  const mobileMatches = (text.match(mobileRe) || []).map(m => m.replace(/[\s-]/g, ''));
  const pincodeRawMatch = text.match(pincodeRe);
  const pincode = pincodeRawMatch ? pincodeRawMatch[0].replace(/\s/g, '') : '';

  let state = null;
  if (typeof INDIAN_STATES !== 'undefined') {
    state = INDIAN_STATES.find(s => new RegExp(s.replace(/\s+/g, '\\s*'), 'i').test(text)) || null;
  }

  lines.forEach((line, idx) => {
    if (gstinRe.test(line)) consumed.add(idx);
    if (emailRe.test(line)) consumed.add(idx);
    if (new RegExp(mobileRe.source).test(line)) consumed.add(idx);
    if (state && new RegExp(state.replace(/\s+/g, '\\s*'), 'i').test(line)) consumed.add(idx);
    if (/^(gstin|gst no|phone|mobile|tel|email|e-mail|www\.|fax)/i.test(line)) consumed.add(idx);
  });

  const remaining = lines.filter((_, idx) => !consumed.has(idx));
  const name = remaining[0] || '';
  const addressLines = remaining.slice(1);
  const pincodeLineIdx = addressLines.findIndex(l => pincodeRe.test(l));
  let city = '';
  if (pincodeLineIdx !== -1) {
    city = addressLines[pincodeLineIdx]
      .replace(pincodeRe, '')
      .replace(/[,\-–]+$/, '')
      .replace(/^[,\-–]+/, '')
      .trim();
  }

  return {
    name,
    address: addressLines.join(', '),
    city,
    state: state || '',
    pincode,
    mobile: mobileMatches[0] || '',
    gstin: gstinMatch ? gstinMatch[0] : '',
    email: emailMatch ? emailMatch[0] : '',
    rawText: text
  };
}

// Photos are often sideways/upside-down; Tesseract assumes horizontal text and
// produces pure noise if the orientation is wrong. Try all 4 rotations and keep
// whichever one OCR itself is most confident about.
async function scanImageToFields(croppedDataUrl, onProgress) {
  const preppedDataUrl = await preprocessImage(croppedDataUrl).catch(() => croppedDataUrl);

  const rotations = [0, 90, 180, 270];
  let best = null;
  for (let i = 0; i < rotations.length; i++) {
    const deg = rotations[i];
    if (onProgress) onProgress(i + 1, rotations.length);
    const rotatedDataUrl = await rotateImage(preppedDataUrl, deg);
    const { text, confidence } = await window.api.ocr.scan(rotatedDataUrl);
    if (!best || confidence > best.confidence) best = { deg, text, confidence };
  }
  return parseOcrText(best.text);
}

// Opens a file picker (or the camera directly when mode === 'camera'), lets
// the user crop out background clutter, runs OCR, and calls onResult(fields)
// or onError(err). onCancel fires if the user backs out of the crop step
// without scanning.
function pickAndScanImage(onResult, onError, onStart, onProgress, onCancel, mode) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (mode === 'camera') input.capture = 'environment';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const rawDataUrl = await fileToDataUrl(file);
    const croppedDataUrl = await cropImageInteractive(rawDataUrl);
    if (!croppedDataUrl) { if (onCancel) onCancel(); return; }
    if (onStart) onStart();
    try {
      const fields = await scanImageToFields(croppedDataUrl, onProgress);
      onResult(fields);
    } catch (err) {
      if (onError) onError(err);
    }
  });
  input.click();
}
