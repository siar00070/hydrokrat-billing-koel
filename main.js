const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createSupabaseContext } = require('./db/supabaseClient');
const { createRemoteStore } = require('./db/remoteStore');
const { computeTotals } = require('./db/logic');
const { createWorker } = require('tesseract.js');
const { createLocalConfig } = require('./db/localConfig');
const ExcelJS = require('exceljs');

let mainWindow;
let supabaseCtx;
let store;
let localConfig;
let ocrWorkerPromise = null;

function getOcrWorker() {
  if (!ocrWorkerPromise) ocrWorkerPromise = createWorker('eng');
  return ocrWorkerPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  supabaseCtx = createSupabaseContext(app.getPath('userData'), safeStorage);
  store = createRemoteStore(supabaseCtx.client, supabaseCtx.numberingClient);
  localConfig = createLocalConfig(app.getPath('userData'));
  registerIpc();
  await supabaseCtx.restoreSession();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  if (ocrWorkerPromise) {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
  }
});

function registerIpc() {
  // ---- OCR (scan photo/file to fill fields) ----
  ipcMain.handle('ocr:scan', async (e, dataUrl) => {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(dataUrl);
    return { text: data.text, confidence: data.confidence };
  });

  // ---- Auth ----
  ipcMain.handle('auth:login', async (e, email, password, remember) => {
    const session = await supabaseCtx.login(email, password, remember);
    return { email: session.user.email };
  });
  ipcMain.handle('auth:logout', async () => {
    await supabaseCtx.logout();
    return true;
  });
  ipcMain.handle('auth:get_session', async () => {
    const user = await supabaseCtx.getCurrentUser();
    return user ? { email: user.email } : null;
  });

  // Company settings
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (e, fields) => store.updateSettings(fields));

  // Customers
  ipcMain.handle('customers:list', (e, search) => store.listCustomers(search));
  ipcMain.handle('customers:get', (e, id) => store.getCustomer(id));
  ipcMain.handle('customers:create', (e, c) => store.createCustomer(c));
  ipcMain.handle('customers:update', (e, id, c) => store.updateCustomer(id, c));
  ipcMain.handle('customers:delete', (e, id) => store.deleteCustomer(id));

  ipcMain.handle('suppliers:list', (e, search) => store.listSuppliers(search));
  ipcMain.handle('suppliers:get', (e, id) => store.getSupplier(id));
  ipcMain.handle('suppliers:create', (e, s) => store.createSupplier(s));
  ipcMain.handle('suppliers:update', (e, id, s) => store.updateSupplier(id, s));
  ipcMain.handle('suppliers:delete', (e, id) => store.deleteSupplier(id));

  // Products
  ipcMain.handle('products:list', (e, search) => store.listProducts(search));
  ipcMain.handle('products:create', (e, p) => store.createProduct(p));
  ipcMain.handle('products:update', (e, id, p) => store.updateProduct(id, p));
  ipcMain.handle('products:delete', (e, id) => store.deleteProduct(id));

  // Documents
  ipcMain.handle('documents:list', (e, filters) => store.listDocuments(filters));
  ipcMain.handle('documents:get', (e, id) => store.getDocument(id));
  ipcMain.handle('documents:preview_number', (e, docType) => {
    const year = new Date().getFullYear();
    return store.peekNextDocNumber(docType, year);
  });
  ipcMain.handle('documents:create', (e, payload) => saveDocument(payload, null));
  ipcMain.handle('documents:update', (e, id, payload) => saveDocument(payload, id));
  ipcMain.handle('documents:delete', (e, id) => store.deleteDocument(id));
  ipcMain.handle('documents:list_deleted', () => store.listDeletedDocuments());
  ipcMain.handle('documents:restore', (e, id) => store.restoreDocument(id));
  ipcMain.handle('documents:purge', (e, id) => store.purgeDocument(id));
  ipcMain.handle('documents:set_payment_status', (e, id, status, details) => store.setPaymentStatus(id, status, details));
  ipcMain.handle('documents:monthly_summary', () => store.getMonthlySummary());
  ipcMain.handle('documents:duplicate_as', async (e, id, newDocType) => {
    const original = await store.getDocument(id);
    if (!original) throw new Error('Document not found');
    const settings = await store.getSettings();
    const termsKeyMap = { quotation: 'quotation_terms', proforma: 'proforma_terms', tax_invoice: 'tax_invoice_terms', purchase_order: 'purchase_order_terms', techno_commercial: 'techno_commercial_terms' };
    const termsKey = termsKeyMap[newDocType];
    const isPO = newDocType === 'purchase_order';
    const payload = {
      doc_type: newDocType,
      doc_date: new Date().toISOString().slice(0, 10),
      valid_until: (newDocType === 'tax_invoice' || newDocType === 'delivery_challan' || isPO) ? null : original.valid_until,
      customer_id: isPO ? null : original.customer_id,
      place_of_supply: isPO ? null : original.place_of_supply,
      discount: original.discount,
      terms: termsKey ? (settings[termsKey] || settings.quotation_terms) : '',
      notes: original.notes,
      project_name: original.project_name || null,
      enquiry_no: isPO ? (original.enquiry_no || original.doc_number) : (original.enquiry_no || null),
      items: (original.items || []).map(it => ({
        product_id: it.product_id, description: it.description, hsn_sac: it.hsn_sac,
        qty: it.qty, rate: it.rate, gst_percent: it.gst_percent,
        use_structured_specs: it.use_structured_specs, spec_flow_head: it.spec_flow_head, spec_model: it.spec_model,
        spec_kw_rpm: it.spec_kw_rpm, spec_moc: it.spec_moc,
        use_engine_spec: it.use_engine_spec, spec_engine: it.spec_engine,
        use_engine_accessories: it.use_engine_accessories, spec_engine_accessories: it.spec_engine_accessories,
        use_accessories: it.use_accessories, spec_accessories: it.spec_accessories
      }))
    };
    return saveDocument(payload, null);
  });

  // PDF export / print
  const OUTPUT_FOLDER_BY_TYPE = { quotation: 'QT', proforma: 'PI', tax_invoice: 'TI', delivery_challan: 'DC', purchase_order: 'PO', techno_commercial: 'TCO' };

  // Completed documents go straight into D:\Hydrokrat KOEL Billing outputs\<QT|PI|TI|DC|PO|TCO>.
  // A PC without a D: drive falls back to Documents so saving never fails outright.
  function outputFolderFor(docType) {
    const sub = OUTPUT_FOLDER_BY_TYPE[docType];
    if (!sub) return null;
    const preferred = 'D:\\Hydrokrat KOEL Billing outputs';
    const base = fs.existsSync('D:\\') ? preferred : path.join(app.getPath('documents'), 'Hydrokrat KOEL Billing outputs');
    const dir = path.join(base, sub);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  ipcMain.handle('document:save_pdf', async (e, html, suggestedName, docType) => {
    const safeName = String(suggestedName || 'document').replace(/[\\/:*?"<>|]/g, '').trim() || 'document';
    const dir = outputFolderFor(docType);
    let filePath;
    if (dir) {
      filePath = path.join(dir, `${safeName}.pdf`);
    } else {
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: 'Save as PDF',
        defaultPath: `${safeName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });
      if (picked.canceled || !picked.filePath) return { success: false };
      filePath = picked.filePath;
    }

    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await loadHtmlIntoWindow(printWin, html);
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    });
    fs.writeFileSync(filePath, pdfBuffer);
    printWin.destroy();
    return { success: true, filePath };
  });

  ipcMain.handle('document:print', async (e, html) => {
    const printWin = new BrowserWindow({ show: false });
    await loadHtmlIntoWindow(printWin, html);
    return new Promise((resolve) => {
      printWin.webContents.print({ printBackground: true }, (success) => {
        printWin.destroy();
        resolve({ success });
      });
    });
  });

  // ---- This PC's branch name (local only, not synced) ----
  ipcMain.handle('branch:get', () => localConfig.getBranchName());
  ipcMain.handle('branch:set', (e, name) => localConfig.setBranchName(name));

  // ---- Shared "permanent delete" password (protects the one irreversible action) ----
  ipcMain.handle('security:has_delete_password', async () => {
    const settings = await store.getSettings();
    return !!settings.delete_password_hash;
  });
  ipcMain.handle('security:set_delete_password', async (e, password) => {
    const hash = password ? crypto.createHash('sha256').update(password).digest('hex') : null;
    await store.updateSettings({ delete_password_hash: hash });
    return true;
  });
  ipcMain.handle('security:verify_delete_password', async (e, password) => {
    const settings = await store.getSettings();
    if (!settings.delete_password_hash) return true; // no password configured — nothing to gate
    if (!password) return false;
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return hash === settings.delete_password_hash;
  });

  // ---- Excel export ----
  ipcMain.handle('export:documents_excel', async (e, filters) => {
    const rows = await store.listDocuments(filters || {});
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Documents to Excel',
      defaultPath: 'HV-KOEL-Documents.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Documents');
    ws.columns = [
      { header: 'Type', key: 'doc_type', width: 14 },
      { header: 'Number', key: 'doc_number', width: 18 },
      { header: 'Date', key: 'doc_date', width: 14 },
      { header: 'Customer', key: 'customer_name', width: 28 },
      { header: 'Branch', key: 'branch_name', width: 14 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST', key: 'sgst', width: 12 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Payment Status', key: 'payment_status', width: 16 },
      { header: 'Due Date', key: 'due_date', width: 14 }
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow({ ...r, customer_name: r.customer_name || r.supplier_name }));
    await wb.xlsx.writeFile(filePath);
    return { success: true, filePath };
  });

  // GSTR-1 B2B export — matches the GST offline utility's "b2b" sheet columns,
  // so it can be imported directly into Tally or the GST portal's return filing tool.
  ipcMain.handle('export:gstr1_excel', async (e, filters) => {
    filters = filters || {};
    const list = await store.listDocuments({ docType: 'tax_invoice' });
    const inRange = list.filter(d =>
      (!filters.from || d.doc_date >= filters.from) &&
      (!filters.to || d.doc_date <= filters.to)
    );

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export GSTR-1 (B2B) Report',
      defaultPath: 'HV-KOEL-GSTR1-B2B.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('b2b');
    ws.columns = [
      { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 20 },
      { header: 'Receiver Name', key: 'receiver', width: 26 },
      { header: 'Invoice Number', key: 'invoice_no', width: 18 },
      { header: 'Invoice date', key: 'invoice_date', width: 14 },
      { header: 'Invoice Value', key: 'invoice_value', width: 14 },
      { header: 'Place Of Supply', key: 'place_of_supply', width: 20 },
      { header: 'Reverse Charge', key: 'reverse_charge', width: 14 },
      { header: 'Applicable % of Tax Rate', key: 'applicable_pct', width: 16 },
      { header: 'Invoice Type', key: 'invoice_type', width: 14 },
      { header: 'E-Commerce GSTIN', key: 'ecom_gstin', width: 16 },
      { header: 'Rate', key: 'rate', width: 10 },
      { header: 'Taxable Value', key: 'taxable_value', width: 16 },
      { header: 'Cess Amount', key: 'cess', width: 12 }
    ];
    ws.getRow(1).font = { bold: true };

    let skippedNoGstin = 0;
    for (const summary of inRange) {
      const doc = await store.getDocument(summary.id);
      const gstin = doc.customer_snapshot && doc.customer_snapshot.gstin;
      if (!gstin) { skippedNoGstin++; continue; }

      const byRate = {};
      (doc.items || []).forEach(it => {
        const rate = Number(it.gst_percent) || 0;
        byRate[rate] = (byRate[rate] || 0) + (Number(it.amount) || 0);
      });

      Object.entries(byRate).forEach(([rate, taxableValue]) => {
        ws.addRow({
          gstin,
          receiver: doc.customer_snapshot.name,
          invoice_no: doc.doc_number,
          invoice_date: doc.doc_date,
          invoice_value: doc.total,
          place_of_supply: doc.place_of_supply || '',
          reverse_charge: 'N',
          applicable_pct: '',
          invoice_type: 'Regular',
          ecom_gstin: '',
          rate: Number(rate),
          taxable_value: Math.round(taxableValue * 100) / 100,
          cess: 0
        });
      });
    }

    await wb.xlsx.writeFile(filePath);
    return { success: true, filePath, skippedNoGstin };
  });

  ipcMain.handle('export:customers_excel', async () => {
    const rows = await store.listCustomers();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Customers to Excel',
      defaultPath: 'HV-KOEL-Customers.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { success: false };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Customers');
    ws.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Address', key: 'address', width: 32 },
      { header: 'City', key: 'city', width: 16 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Pincode', key: 'pincode', width: 12 },
      { header: 'Mobile', key: 'mobile', width: 16 },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'GSTIN', key: 'gstin', width: 18 }
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach(r => ws.addRow(r));
    await wb.xlsx.writeFile(filePath);
    return { success: true, filePath };
  });

  // ---- Send helpers (quick-helper: no SMTP credentials needed) ----
  ipcMain.handle('document:reveal_in_folder', (e, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('document:open_mailto', (e, { to, subject, body }) => {
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    shell.openExternal(`mailto:${to || ''}?${params.toString()}`);
    return true;
  });
  ipcMain.handle('document:open_external', (e, url) => {
    shell.openExternal(url);
    return true;
  });
}

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;

  function pushStatus(status, extra) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update_status', { status, ...extra });
    }
  }

  autoUpdater.on('update-available', (info) => pushStatus('available', { version: info.version }));
  autoUpdater.on('download-progress', (p) => pushStatus('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => pushStatus('ready'));
  autoUpdater.on('error', (err) => pushStatus('error', { message: err.message }));

  ipcMain.handle('app:install_update', () => autoUpdater.quitAndInstall());
  ipcMain.handle('app:get_version', () => app.getVersion());

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => pushStatus('error', { message: err.message }));
  }
}

// Loading big HTML (embedded logo/watermark/signature images) via a data: URL
// hits Chromium's max URL length; writing to a temp file has no such limit.
async function loadHtmlIntoWindow(win, html) {
  const tempPath = path.join(app.getPath('temp'), `hv-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tempPath, html, 'utf-8');
  try {
    await win.loadFile(tempPath);
  } finally {
    fs.unlink(tempPath, () => {});
  }
}

async function saveDocument(payload, existingId) {
  const settings = await store.getSettings();
  const isPurchaseOrder = payload.doc_type === 'purchase_order';
  const customer = !isPurchaseOrder && payload.customer_id ? await store.getCustomer(payload.customer_id) : null;
  const supplier = isPurchaseOrder && payload.supplier_id ? await store.getSupplier(payload.supplier_id) : null;
  const partyState = payload.place_of_supply || (isPurchaseOrder ? (supplier ? supplier.state : '') : (customer ? customer.state : ''));

  const items = payload.items.map((it, idx) => ({
    product_id: it.product_id || null,
    description: it.description,
    hsn_sac: it.hsn_sac || '',
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
    gst_percent: Number(it.gst_percent) || 0,
    amount: Math.round((Number(it.qty) * Number(it.rate) + Number.EPSILON) * 100) / 100,
    use_structured_specs: !!it.use_structured_specs,
    spec_flow_head: it.use_structured_specs ? (it.spec_flow_head || null) : null,
    spec_model: it.use_structured_specs ? (it.spec_model || null) : null,
    spec_kw_rpm: it.use_structured_specs ? (it.spec_kw_rpm || null) : null,
    spec_moc: it.use_structured_specs ? (it.spec_moc || null) : null,
    use_engine_spec: !!it.use_engine_spec,
    spec_engine: it.use_engine_spec ? (it.spec_engine || null) : null,
    use_engine_accessories: !!it.use_engine_accessories,
    spec_engine_accessories: it.use_engine_accessories ? (it.spec_engine_accessories || null) : null,
    use_accessories: !!it.use_accessories,
    spec_accessories: it.use_accessories ? (it.spec_accessories || null) : null,
    use_pricing_calc: !!it.use_pricing_calc,
    use_acc_pricing_calc: !!it.use_acc_pricing_calc,
    item_lp: it.use_pricing_calc ? (it.item_lp ?? null) : null,
    item_discount_pct: it.use_pricing_calc ? (it.item_discount_pct ?? null) : null,
    item_freight: (it.use_pricing_calc || it.use_acc_pricing_calc) ? (it.item_freight ?? null) : null,
    item_margin_pct: (it.use_pricing_calc || it.use_acc_pricing_calc) ? (it.item_margin_pct ?? null) : null,
    item_fixed_price: (it.use_pricing_calc || it.use_acc_pricing_calc) ? (it.item_fixed_price ?? null) : null,
    item_acc_lp: it.use_acc_pricing_calc ? (it.item_acc_lp ?? null) : null,
    item_acc_discount_pct: it.use_acc_pricing_calc ? (it.item_acc_discount_pct ?? null) : null,
    item_eng_acc_lp: it.use_acc_pricing_calc ? (it.item_eng_acc_lp ?? null) : null,
    item_eng_acc_discount_pct: it.use_acc_pricing_calc ? (it.item_eng_acc_discount_pct ?? null) : null,
    sort_order: idx
  }));

  const totals = computeTotals({
    items,
    discount: Number(payload.discount) || 0,
    sellerState: settings.state,
    customerState: partyState
  });

  const record = {
    doc_type: payload.doc_type,
    doc_date: payload.doc_date,
    valid_until: payload.valid_until || null,
    customer_id: isPurchaseOrder ? null : (payload.customer_id || null),
    customer_snapshot: isPurchaseOrder ? null : (customer || null),
    supplier_id: isPurchaseOrder ? (payload.supplier_id || null) : null,
    supplier_snapshot: isPurchaseOrder ? (supplier || null) : null,
    place_of_supply: partyState,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    round_off: totals.roundOff,
    total: totals.total,
    terms: payload.terms || '',
    notes: payload.notes || '',
    due_date: payload.due_date || null,
    payment_status: payload.payment_status || null,
    vehicle_no: payload.vehicle_no || null,
    transporter_name: payload.transporter_name || null,
    driver_name: payload.driver_name || null,
    driver_contact: payload.driver_contact || null,
    place_of_delivery: payload.place_of_delivery || null,
    transport_reason: payload.transport_reason || null,
    include_signature: payload.include_signature !== false,
    include_stamp: payload.include_stamp !== false,
    ship_to_same: payload.ship_to_same !== false,
    ship_to_name: payload.ship_to_same === false ? (payload.ship_to_name || null) : null,
    ship_to_address: payload.ship_to_same === false ? (payload.ship_to_address || null) : null,
    ship_to_city: payload.ship_to_same === false ? (payload.ship_to_city || null) : null,
    ship_to_state: payload.ship_to_same === false ? (payload.ship_to_state || null) : null,
    ship_to_pincode: payload.ship_to_same === false ? (payload.ship_to_pincode || null) : null,
    project_name: payload.project_name || null,
    enquiry_no: payload.enquiry_no || null,
    deliver_to_same: payload.deliver_to_same !== false,
    deliver_to_name: payload.deliver_to_same === false ? (payload.deliver_to_name || null) : null,
    deliver_to_address: payload.deliver_to_same === false ? (payload.deliver_to_address || null) : null,
    deliver_to_city: payload.deliver_to_same === false ? (payload.deliver_to_city || null) : null,
    deliver_to_state: payload.deliver_to_same === false ? (payload.deliver_to_state || null) : null,
    deliver_to_pincode: payload.deliver_to_same === false ? (payload.deliver_to_pincode || null) : null,
    is_revised: !!payload.is_revised,
    revision_no: payload.is_revised ? (Number(payload.revision_no) || 1) : 0,
    price_basis: payload.price_basis || null,
    payment_terms: payload.payment_terms || null,
    packing_terms: payload.packing_terms || null,
    freight_terms: payload.freight_terms || null,
    warranty_terms: payload.warranty_terms || null,
    scope_of_supply: payload.scope_of_supply || null,
    delivery_schedule: payload.delivery_schedule || null,
    delivery_type: payload.delivery_type || null,
    transportation: payload.transportation || null,
    items
  };

  if (!existingId) {
    const year = new Date(payload.doc_date).getFullYear() || new Date().getFullYear();
    record.doc_number = await store.nextDocNumber(payload.doc_type, year);
    record.branch_name = localConfig.getBranchName() || null;
  }

  const saved = await store.saveDocument(record, existingId);
  await addNewItemsToProducts(items);
  return saved;
}

// Items typed in by hand are remembered in Products (description + specs/model only, no pricing)
// so they can be picked next time and fill the spec fields. Existing products (same description and
// specs) are left untouched; failures never block the save.
async function addNewItemsToProducts(items) {
  try {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const keyOf = (o) => norm([o.description, o.spec_flow_head, o.spec_model, o.spec_kw_rpm, o.spec_moc,
      o.spec_engine, o.spec_engine_accessories, o.spec_accessories].join('|'));
    const known = new Set((await store.listProducts()).map(keyOf));
    for (const it of items) {
      const description = String(it.description || '').split('\n').map(l => l.trim()).filter(Boolean)
        .slice(0, it.use_structured_specs ? 1 : undefined).join('\n');
      if (!description) continue;
      const rec = {
        description, hsn_sac: it.hsn_sac, default_rate: 0, gst_percent: it.gst_percent, unit: 'Nos',
        use_structured_specs: !!it.use_structured_specs,
        spec_flow_head: it.use_structured_specs ? it.spec_flow_head : null,
        spec_model: it.use_structured_specs ? it.spec_model : null,
        spec_kw_rpm: it.use_structured_specs ? it.spec_kw_rpm : null,
        spec_moc: it.use_structured_specs ? it.spec_moc : null,
        use_engine_spec: !!it.use_engine_spec, spec_engine: it.use_engine_spec ? it.spec_engine : null,
        use_engine_accessories: !!it.use_engine_accessories,
        spec_engine_accessories: it.use_engine_accessories ? it.spec_engine_accessories : null,
        use_accessories: !!it.use_accessories, spec_accessories: it.use_accessories ? it.spec_accessories : null
      };
      const key = keyOf(rec);
      if (known.has(key)) continue;
      await store.createProduct(rec);
      known.add(key);
    }
  } catch (err) {
    console.error('Could not add items to products:', err.message);
  }
}
