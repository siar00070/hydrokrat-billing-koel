// Stock list as an Excel workbook: one sheet per item, one sheet per serial number.
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
  rows.forEach(r => ws.addRow({
    description: r.description, hsn_sac: r.hsn_sac, qty: r.qty, missing: r.missing || null,
    serial_text: r.no_serial ? 'No serial no.' : r.serials.join(', ')
  }));
  ws.addRow({
    description: 'Total', qty: rows.reduce((n, r) => n + r.qty, 0),
    missing: rows.reduce((n, r) => n + r.missing, 0) || null
  }).font = { bold: true };

  const serials = wb.addWorksheet('Serial Nos');
  serials.columns = [
    { header: 'Serial No', key: 'serial_no', width: 22 },
    { header: 'Item', key: 'description', width: 70 },
    { header: 'Purchase Invoice', key: 'invoice_no', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 13 },
    { header: 'Supplier', key: 'supplier', width: 38 }
  ];
  serials.getRow(1).font = { bold: true };
  serials.views = [{ state: 'frozen', ySplit: 1 }];
  rows.flatMap(r => r.serial_rows).forEach(r => serials.addRow(r));
  return wb;
}

module.exports = { buildStockWorkbook };
