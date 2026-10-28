// Reads a supplier's tax-invoice PDF (text-based, e.g. KOEL Fluid Dynamics e-invoices) into
// a purchase invoice draft: header, item lines with qty / rate and the serial numbers.
// The result is only a draft — the user checks it in the Add Purchase Invoice form before saving.

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

let pdfjsLib = null;
function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // pdfjs warns at load time that canvas rendering is unavailable; only text is needed here.
  const { warn, log } = console;
  console.warn = console.log = () => {};
  try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.warn = warn; console.log = log; }
  return pdfjsLib;
}

async function extractPdfText(bytes) {
  const pdfjs = loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, verbosity: 0
  }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : '');
    text += '\n';
  }
  return text;
}

function parseDate(s) {
  const m = String(s || '').match(/(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()] || parseInt(m[2], 10);
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// "AB100 to AB103,AB110" -> [AB100, AB101, AB102, AB103, AB110]; tolerates a missing comma
// between two serials and serials broken across lines.
function expandSerials(block) {
  const joined = block.replace(/\s*\bto\b\s*/gi, ' to ').replace(/\n/g, '');
  const tokens = joined.match(/[A-Za-z]+\d+|\bto\b/gi) || [];
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toUpperCase();
    if (tok === 'TO') continue;
    if ((tokens[i + 1] || '').toLowerCase() === 'to' && tokens[i + 2]) {
      const end = tokens[i + 2].toUpperCase();
      const a = tok.match(/^([A-Z]+)(\d+)$/), b = end.match(/^([A-Z]+)(\d+)$/);
      const from = parseInt(a[2], 10), to = parseInt(b[2], 10);
      if (a[1] === b[1] && to >= from && to - from < 5000) {
        for (let n = from; n <= to; n++) out.push(a[1] + String(n).padStart(a[2].length, '0'));
      } else {
        out.push(tok, end);
      }
      i += 2;
    } else {
      out.push(tok);
    }
  }
  return out;
}

const SERIAL_LINE = /^[A-Za-z]{1,4}\d{4,}/;
const ITEM_START = /^(\d{1,3})\s+([A-Z0-9][A-Z0-9.\-]{8,})\s*$/;

function parseInvoiceText(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const header = {
    invoice_no: (all.match(/Invoice\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9/\-]*)/i) || [])[1] || '',
    invoice_date: parseDate((all.match(/Invoice\s*Date\s*:?\s*([0-9]{1,2}[-/ ][A-Za-z0-9]{2,3}[-/ ][0-9]{4})/i) || [])[1]),
    supplier_name: (lines.find(l => /\b(PRIVATE LIMITED|PVT\.? LTD|LIMITED)\b/i.test(l) && !/formerly/i.test(l)) || '').trim(),
    supplier_gstin: (all.match(/GSTIN\s*:?\s*([0-9]{2}[A-Z0-9]{13})/i) || [])[1] || '',
    po_number: ((all.match(/PO\s*No\.?[^:\n]*:\s*([A-Z0-9][A-Z0-9/\-]+)/i) || [])[1] || '').replace(/^by$/i, '')
  };

  const items = [];
  let cur = null;
  let stage = null; // 'desc' | 'serial' | 'tail'
  const finish = () => { if (cur) items.push(cur); cur = null; };

  for (const line of lines) {
    const start = line.match(ITEM_START);
    if (start) {
      finish();
      cur = { code: start[2], descLines: [], serialLines: [], tail: [] };
      stage = 'desc';
      continue;
    }
    if (!cur) continue;
    if (/^Total\b/i.test(line)) { finish(); continue; }
    if (/^(SO No|PO No)/i.test(line)) { stage = 'tail'; continue; }
    if (stage === 'desc' && SERIAL_LINE.test(line) && !/\bHP\b/i.test(line)) stage = 'serial';
    if (stage === 'desc') cur.descLines.push(line);
    else if (stage === 'serial') cur.serialLines.push(line);
    else cur.tail.push(line);
  }
  finish();

  const result = items.map(it => {
    const tail = it.tail.join(' ');
    const nums = (tail.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    // HSN is the longest whole code (8, then 6, then 4 digits) — a wrapped "2026" from the SO date is not it.
    const hsnIdx = [8, 6, 4].map(len => nums.findIndex(n => Number.isInteger(n) && String(n).length === len && !(len === 4 && n >= 1990 && n <= 2100)))
      .find(i => i >= 0) ?? -1;
    const qty = hsnIdx >= 0 ? nums[hsnIdx + 1] : null;
    const taxable = Number((tail.match(/([\d.]+)\s*(?:IGST|CGST|SGST)/i) || [])[1]);
    const serials = expandSerials(it.serialLines.join('\n'));
    return {
      item_code: it.code,
      description: it.descLines.join(' ').replace(/\s+/g, ' ').trim(),
      hsn_sac: hsnIdx >= 0 ? String(nums[hsnIdx]) : '',
      qty: qty || serials.length,
      rate: qty && taxable ? Math.round((taxable / qty) * 100) / 100 : 0,
      serials
    };
  });
  return { ...header, lines: result };
}

// Best product for an invoice description: a product whose model (either side of "OF / WF")
// starts the description, longest match first; ties broken by HP and stage count.
function matchProduct(description, products) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const target = norm(description);
  const hp = (String(description).match(/([\d.]+)\s*HP/i) || [])[1];
  const stage = (String(description).match(/(\d+)\s*STAGE/i) || [])[1];
  let best = null;
  for (const p of products) {
    const models = String(p.spec_model || '').split('/').map(norm).filter(m => m.length >= 3);
    const len = Math.max(0, ...models.filter(m => target.startsWith(m)).map(m => m.length));
    if (!len) continue;
    let score = len * 10;
    if (hp && new RegExp(`\\b${hp.replace('.', '\\.')} HP\\b`).test(p.description)) score += 5;
    if (stage && new RegExp(`\\b${stage} Stage\\b`, 'i').test(p.description)) score += 5;
    if (!best || score > best.score) best = { score, product: p };
  }
  return best ? best.product : null;
}

module.exports = { extractPdfText, parseInvoiceText, expandSerials, matchProduct, parseDate };
