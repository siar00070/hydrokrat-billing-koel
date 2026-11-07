// Product sections and photos for the Products page. The same rules are used by the dealer stock page
// (dealer-page/index.src.html): change one, change the other. Photos are in pumpPhotos.js.

const PRODUCT_SECTIONS = [
  'Borewell Submersible', 'Openwell Submersible', 'Mini and Self-priming Monoblock', 'Centrifugal Monoblock',
  'Pressure Booster and Circulation', 'Sewage', 'Column Pipes', 'Motors', 'Control Panels', 'Other'
];
// Sections that get a heading per size or type.
const PRODUCT_HEADED = new Set(['Borewell Submersible', 'Openwell Submersible', 'Centrifugal Monoblock', 'Sewage']);
const BOREWELL_INCH = { V3: '3 inch', V4: '4 inch', V5: '5 inch', V6: '6 inch', V7: '7 inch', V8: '8 inch', V9: '9 inch' };

// "KOEL Varuna <family> - <model> - ..." -> "<family>"
function productFamily(description) {
  return String(description || '').replace(/^KOEL Varuna\s+/i, '').split(' - ')[0];
}

function productSection(description) {
  const family = productFamily(description);
  if (/control panel/i.test(description)) return 'Control Panels';
  if (/Borewell Submersible/i.test(family)) return 'Borewell Submersible';
  if (/Openwell/i.test(family)) return 'Openwell Submersible';
  if (/^VSWA?\b|^AdvantACE/i.test(family)) return 'Mini and Self-priming Monoblock';
  if (/^CMB/i.test(family)) return 'Centrifugal Monoblock';
  if (/Booster|Circulation|Jet Pump/i.test(family)) return 'Pressure Booster and Circulation';
  if (/Sewage/i.test(family)) return 'Sewage';
  if (/Column Pipe/i.test(family)) return 'Column Pipes';
  if (/Induction Motor/i.test(family)) return 'Motors';
  if (/Monoblock|Self Priming/i.test(family)) return 'Mini and Self-priming Monoblock';
  return 'Other';
}

// Heading inside a section: the borewell size ("4 inch · V4 · 100 mm"), otherwise the product family.
function productSubheading(section, description) {
  const family = productFamily(description);
  const m = family.match(/^(V\d)\s+Borewell Submersible Pumpset\s*\(([^)]*)\)/i);
  if (section === 'Borewell Submersible' && m) {
    const v = m[1].toUpperCase();
    return `${BOREWELL_INCH[v] || v} · ${v} · ${m[2].split(',')[0].trim()}`;
  }
  return section === 'Other' || !PRODUCT_HEADED.has(section) ? '' : family;
}

// Which photo a product uses, from its family. First match wins, so the specific names come first.
const PRODUCT_PHOTO_RULES = [
  [/^V([3-9]) Borewell/i, m => (m[1] === '3' || m[1] === '4') ? 'v' + m[1] : 'vrange'], [/^Mini HMPS/i, 'minihmps'],
  [/^HMPS/i, 'hmps'], [/^Ultra/i, 'ultra'], [/^VMPS/i, 'vmps'], [/^VSSP/i, 'vssp'], [/^VSCP/i, 'vscp'],
  [/^CMB Class B/i, 'cmbb'], [/^CMB/i, 'cmba'], [/^Ivory II/i, 'ivory2'], [/^Ivory Pro/i, 'ivorypro'],
  [/^Topaz/i, 'topaz'], [/^Super Gold/i, 'supergold'], [/^Emerald/i, 'emerald'], [/^Diamond/i, 'diamond'],
  [/^VMSJP/i, 'vmsjp'], [/^VMS\b/i, 'vms'], [/^VSWA/i, 'vswa'], [/^VSW\b/i, 'vsw'], [/^Crystal/i, 'crystal'],
  [/^Pearl/i, 'pearl'], [/^Hira/i, 'hira'], [/^AdvantACE/i, 'advantace'],
  [/Pressure Booster Pumpset/i, 'boosterset'], [/Pressure Booster/i, 'boosterpump'], [/Circulation/i, 'vilc'],
  [/Heavy Duty Self Priming/i, 'vmb'], [/Column Pipe/i, 'pipe'], [/control panel/i, 'panel']
];

// The photo (data URI) for a product description, or null when there is none.
function productPhoto(description) {
  const family = productFamily(description);
  for (const [re, name] of PRODUCT_PHOTO_RULES) {
    const m = family.match(re);
    if (m) {
      const key = typeof name === 'function' ? name(m) : name;
      return PUMP_PHOTOS[key] || null;
    }
  }
  return null;
}

// Stock list rows ({ description, qty, missing, ... }) sorted into the catalogue sections, for the Excel and PDF
// downloads: [{ section, qty, missing, groups: [{ sub, rows }] }]. `sub` is '' when a section has only one heading.
function groupStockRows(rows) {
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const bySection = new Map();
  rows.forEach(r => {
    const section = productSection(r.description);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push({ r, sub: productSubheading(section, r.description) });
  });
  return PRODUCT_SECTIONS.filter(s => bySection.has(s)).map(section => {
    const items = bySection.get(section).sort((a, b) => natural(a.sub, b.sub) || natural(a.r.description, b.r.description));
    const many = new Set(items.map(i => i.sub)).size > 1;
    const groups = [];
    items.forEach(({ r, sub }) => {
      const key = many ? sub : '';
      if (!groups.length || groups[groups.length - 1].sub !== key) groups.push({ sub: key, rows: [] });
      groups[groups.length - 1].rows.push(r);
    });
    return { section, qty: items.reduce((n, i) => n + i.r.qty, 0), missing: items.reduce((n, i) => n + i.r.missing, 0), groups };
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { groupStockRows, productSection };
