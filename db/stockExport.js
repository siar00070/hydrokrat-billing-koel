// Stock list as an Excel workbook: items grouped under the catalogue sections (Borewell, Openwell ...),
// then one sheet with every serial number.
const { groupStockRows, productSection } = require('../src/js/pumpCatalog');

const GREEN = 'FFE2ECE8';

function buildStockWorkbook(ExcelJS, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stock List');
  ws.columns = [
    { header: 'Item', key: 'description', width: 70 },
    { header: 'HSN', key: 'hsn_sac', width: 12 },
    { header: 'Qty in Stock', key: 'qty', width: 13 },
    { header: 'Missing', key: 'missing', width: 10 },
    { header: 'Serial Nos', key: 'serial_text', width: 80 }
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  groupStockRows(rows).forEach(sec => {
    const head = ws.addRow({ description: sec.section, qty: sec.qty, missing: sec.missing || null });
    head.font = { bold: true, size: 12 };
    head.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
    sec.groups.forEach(g => {
      if (g.sub) ws.addRow({ description: '   ' + g.sub }).font = { bold: true, italic: true, color: { argb: 'FF1F7A5C' } };
      g.rows.forEach(r => ws.addRow({
        description: r.description, hsn_sac: r.hsn_sac, qty: r.qty, missing: r.missing || null,
        serial_text: r.no_serial ? 'No serial no.' : r.serials.join(', ')
      }));
    });
  });
  ws.addRow({
    description: 'Total', qty: rows.reduce((n, r) => n + r.qty, 0),
    missing: rows.reduce((n, r) => n + r.missing, 0) || null
  }).font = { bold: true };

  const serials = wb.addWorksheet('Serial Nos');
  serials.columns = [
    { header: 'Serial No', key: 'serial_no', width: 22 },
    { header: 'Section', key: 'section', width: 30 },
    { header: 'Item', key: 'description', width: 70 },
    { header: 'Purchase Invoice', key: 'invoice_no', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 13 },
    { header: 'Supplier', key: 'supplier', width: 38 }
  ];
  serials.getRow(1).font = { bold: true };
  serials.views = [{ state: 'frozen', ySplit: 1 }];
  groupStockRows(rows).forEach(sec => sec.groups.forEach(g => g.rows.forEach(r => r.serial_rows.forEach(sr =>
    serials.addRow({ ...sr, section: productSection(sr.description) })))));
  return wb;
}

module.exports = { buildStockWorkbook };
