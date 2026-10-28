const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  ocr: {
    scan: (dataUrl) => ipcRenderer.invoke('ocr:scan', dataUrl)
  },
  auth: {
    login: (email, password, remember) => ipcRenderer.invoke('auth:login', email, password, remember),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getSession: () => ipcRenderer.invoke('auth:get_session')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (data) => ipcRenderer.invoke('settings:update', data)
  },
  customers: {
    list: (search) => ipcRenderer.invoke('customers:list', search),
    get: (id) => ipcRenderer.invoke('customers:get', id),
    create: (c) => ipcRenderer.invoke('customers:create', c),
    update: (id, c) => ipcRenderer.invoke('customers:update', id, c),
    delete: (id) => ipcRenderer.invoke('customers:delete', id)
  },
  suppliers: {
    list: (search) => ipcRenderer.invoke('suppliers:list', search),
    get: (id) => ipcRenderer.invoke('suppliers:get', id),
    create: (s) => ipcRenderer.invoke('suppliers:create', s),
    update: (id, s) => ipcRenderer.invoke('suppliers:update', id, s),
    delete: (id) => ipcRenderer.invoke('suppliers:delete', id)
  },
  products: {
    list: (search) => ipcRenderer.invoke('products:list', search),
    create: (p) => ipcRenderer.invoke('products:create', p),
    update: (id, p) => ipcRenderer.invoke('products:update', id, p),
    delete: (id) => ipcRenderer.invoke('products:delete', id)
  },
  stock: {
    listUnits: (search) => ipcRenderer.invoke('stock:list_units', search),
    listPurchaseInvoices: () => ipcRenderer.invoke('stock:list_purchase_invoices'),
    createPurchaseInvoice: (inv) => ipcRenderer.invoke('stock:create_purchase_invoice', inv),
    deletePurchaseInvoice: (id) => ipcRenderer.invoke('stock:delete_purchase_invoice', id),
    parseInvoicePdf: (bytes) => ipcRenderer.invoke('stock:parse_invoice_pdf', bytes)
  },
  documents: {
    list: (filters) => ipcRenderer.invoke('documents:list', filters),
    get: (id) => ipcRenderer.invoke('documents:get', id),
    previewNumber: (docType) => ipcRenderer.invoke('documents:preview_number', docType),
    create: (payload) => ipcRenderer.invoke('documents:create', payload),
    update: (id, payload) => ipcRenderer.invoke('documents:update', id, payload),
    delete: (id) => ipcRenderer.invoke('documents:delete', id),
    duplicateAs: (id, newDocType) => ipcRenderer.invoke('documents:duplicate_as', id, newDocType),
    listDeleted: () => ipcRenderer.invoke('documents:list_deleted'),
    restore: (id) => ipcRenderer.invoke('documents:restore', id),
    purge: (id) => ipcRenderer.invoke('documents:purge', id),
    setPaymentStatus: (id, status, details) => ipcRenderer.invoke('documents:set_payment_status', id, status, details),
    monthlySummary: () => ipcRenderer.invoke('documents:monthly_summary')
  },
  document: {
    savePdf: (html, suggestedName, docType) => ipcRenderer.invoke('document:save_pdf', html, suggestedName, docType),
    print: (html) => ipcRenderer.invoke('document:print', html),
    revealInFolder: (filePath) => ipcRenderer.invoke('document:reveal_in_folder', filePath),
    openMailto: (opts) => ipcRenderer.invoke('document:open_mailto', opts),
    openExternal: (url) => ipcRenderer.invoke('document:open_external', url)
  },
  branch: {
    get: () => ipcRenderer.invoke('branch:get'),
    set: (name) => ipcRenderer.invoke('branch:set', name)
  },
  security: {
    hasDeletePassword: () => ipcRenderer.invoke('security:has_delete_password'),
    setDeletePassword: (password) => ipcRenderer.invoke('security:set_delete_password', password),
    verifyDeletePassword: (password) => ipcRenderer.invoke('security:verify_delete_password', password)
  },
  exportExcel: {
    documents: (filters) => ipcRenderer.invoke('export:documents_excel', filters),
    customers: () => ipcRenderer.invoke('export:customers_excel'),
    gstr1: (filters) => ipcRenderer.invoke('export:gstr1_excel', filters)
  },
  updates: {
    getVersion: () => ipcRenderer.invoke('app:get_version'),
    install: () => ipcRenderer.invoke('app:install_update'),
    onStatus: (callback) => ipcRenderer.on('app:update_status', (e, data) => callback(data))
  }
});
