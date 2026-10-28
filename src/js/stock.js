// Stock: serial-numbered units received on supplier purchase invoices (against a PO or direct)
// and taken out by Tax Invoices / Delivery Challans.

const STOCK_OUT_LABEL = { tax_invoice: 'Sold', delivery_challan: 'Delivered' };

function parseSerials(text) {
  return String(text || '').split(/[\n,;]+/).map(s => s.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean);
}

function productLabel(p) {
  return String(p.description || '').split('\n')[0] + (p.spec_model && !String(p.description).includes(p.spec_model) ? ' — ' + p.spec_model : '');
}

async function renderStock(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Stock']));

  const tabs = [['instock', 'Inventory'], ['serials', 'All Serial Nos'], ['invoices', 'Purchase Invoices']];
  let active = 'instock';
  const tabRow = el('div', { class: 'btn-row', style: 'margin-bottom:14px' });
  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search serial no. or item...' });
  searchRow.appendChild(searchInput);
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => openPurchaseInvoiceModal({}, load) }, ['+ Add Purchase Invoice']));
  const card = el('div', { class: 'card' });
  root.appendChild(tabRow);
  root.appendChild(searchRow);
  root.appendChild(card);

  function drawTabs() {
    tabRow.innerHTML = '';
    tabs.forEach(([key, label]) => tabRow.appendChild(el('button', {
      class: `btn ${key === active ? '' : 'secondary'}`,
      onclick: () => { active = key; drawTabs(); load(); }
    }, [label])));
    searchInput.style.display = active === 'invoices' ? 'none' : '';
  }

  async function load() {
    card.innerHTML = '';
    if (active === 'invoices') return drawInvoices();
    const units = await window.api.stock.listUnits(searchInput.value.trim());
    if (active === 'instock') drawInStock(units.filter(u => !u.out_document_id));
    else drawSerials(units);
  }

  function drawInStock(units) {
    if (units.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['Nothing in stock. Use "+ Add Purchase Invoice" to receive goods.']));
      return;
    }
    const groups = new Map();
    units.forEach(u => {
      const key = u.product_id ? 'p' + u.product_id : 'd' + u.description;
      if (!groups.has(key)) groups.set(key, { description: u.description, units: [] });
      groups.get(key).units.push(u);
    });
    const tbody = el('tbody');
    [...groups.values()].forEach(g => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [String(g.description).split('\n')[0]]),
        el('td', { style: 'text-align:center;font-weight:700' }, [String(g.units.length)]),
        el('td', { style: 'font-size:12px' }, [g.units.map(u => u.serial_no).join(', ')])
      ]));
    });
    card.appendChild(el('div', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px' }, [`${units.length} unit(s) in stock`]));
    card.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Item']), el('th', {}, ['Qty']), el('th', {}, ['Serial Nos'])])]),
      tbody
    ]));
  }

  function drawSerials(units) {
    if (units.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['No serial numbers found.']));
      return;
    }
    const tbody = el('tbody');
    units.forEach(u => {
      const inv = u.purchase_invoices || {};
      const out = u.documents;
      tbody.appendChild(el('tr', {}, [
        el('td', { style: 'font-weight:600' }, [u.serial_no]),
        el('td', {}, [String(u.description).split('\n')[0]]),
        el('td', {}, [`${inv.invoice_no || '-'}${inv.invoice_date ? ' (' + fmtDate(inv.invoice_date) + ')' : ''}`]),
        el('td', {}, [inv.supplier_snapshot ? inv.supplier_snapshot.name : '-']),
        el('td', {}, [out
          ? el('span', {
              class: `badge ${out.doc_type}`, style: 'cursor:pointer',
              onclick: () => navigate('document-editor', { docId: out.id })
            }, [`${STOCK_OUT_LABEL[out.doc_type] || 'Out'}: ${out.doc_number}`])
          : el('span', { style: 'color:#15803d;font-weight:600' }, ['In stock'])])
      ]));
    });
    card.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Serial No']), el('th', {}, ['Item']), el('th', {}, ['Purchase Invoice']),
        el('th', {}, ['Supplier']), el('th', {}, ['Status'])
      ])]),
      tbody
    ]));
  }

  async function drawInvoices() {
    const list = await window.api.stock.listPurchaseInvoices();
    if (list.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['No purchase invoices yet.']));
      return;
    }
    const tbody = el('tbody');
    list.forEach(inv => {
      tbody.appendChild(el('tr', {}, [
        el('td', { style: 'font-weight:600' }, [inv.invoice_no]),
        el('td', {}, [fmtDate(inv.invoice_date)]),
        el('td', {}, [inv.supplier_name || '-']),
        el('td', {}, [inv.po_number || 'Direct']),
        el('td', {}, [`${inv.in_stock_count} / ${inv.unit_count} in stock`]),
        el('td', {}, [el('span', { class: 'btn small danger', onclick: async () => {
          if (!confirmDialog(`Delete purchase invoice ${inv.invoice_no} and its ${inv.unit_count} serial no(s) from stock?`)) return;
          await window.api.stock.deletePurchaseInvoice(inv.id);
          showToast('Purchase invoice deleted');
          load();
        } }, ['Delete'])])
      ]));
    });
    card.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Invoice No']), el('th', {}, ['Date']), el('th', {}, ['Supplier']),
        el('th', {}, ['PO']), el('th', {}, ['Units']), el('th', {}, [''])
      ])]),
      tbody
    ]));
  }

  searchInput.addEventListener('input', debounce(load, 250));
  drawTabs();
  load();
}

// Receive goods: supplier invoice header + one line per item with one serial per unit.
// opts.poId pre-selects a Purchase Order and fills the lines from it.
async function openPurchaseInvoiceModal(opts, onSaved) {
  const [suppliers, products, pos] = await Promise.all([
    window.api.suppliers.list(), window.api.products.list(), window.api.documents.list({ docType: 'purchase_order' })
  ]);
  const productByLabel = new Map(products.map(p => [productLabel(p), p]));

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const supplierSelect = el('select', {}, [
    el('option', { value: '' }, ['Select supplier...']),
    ...suppliers.map(s => el('option', { value: s.id }, [s.name]))
  ]);
  const poSelect = el('select', {}, [
    el('option', { value: '' }, ['No PO — direct purchase']),
    ...pos.map(p => el('option', { value: p.id }, [`${p.doc_number}${p.supplier_name ? ' — ' + p.supplier_name : ''}`]))
  ]);
  const invoiceNoInput = el('input', { placeholder: "Supplier's invoice number" });
  const invoiceDateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const notesInput = el('input', { placeholder: 'Optional' });

  const datalist = el('datalist', { id: 'stock-product-list' }, [...productByLabel.keys()].map(label => el('option', { value: label })));
  let lines = [];
  const linesBody = el('tbody');

  function blankLine() { return { product_id: null, description: '', hsn_sac: '', qty: 1, rate: 0, serialsText: '' }; }

  function drawLines() {
    linesBody.innerHTML = '';
    lines.forEach((line, idx) => {
      const itemTitle = line.description ? String(line.description).split('\n')[0] : '';
      const itemInput = el('input', { list: 'stock-product-list', value: itemTitle, title: itemTitle, placeholder: 'Type to search products...' });
      itemInput.addEventListener('change', () => {
        const p = productByLabel.get(itemInput.value);
        if (p) { line.product_id = p.id; line.description = p.description; line.hsn_sac = p.hsn_sac || ''; if (!line.rate) line.rate = p.default_rate || 0; }
        else { line.product_id = null; line.description = itemInput.value.trim(); }
        drawLines();
      });
      const qtyInput = el('input', { type: 'number', min: '1', step: '1', value: line.qty, style: 'width:70px' });
      const rateInput = el('input', { type: 'number', step: '0.01', value: line.rate, style: 'width:100px' });
      const serialsInput = el('textarea', { rows: Math.min(Math.max(line.qty, 2), 8), placeholder: 'One serial no. per line (or comma separated)' }, [line.serialsText]);
      const countNote = el('div', { style: 'font-size:11px;margin-top:2px' });
      const refreshCount = () => {
        const n = parseSerials(line.serialsText).length;
        countNote.textContent = `${n} / ${line.qty} serial no(s)`;
        countNote.style.color = n === line.qty ? '#15803d' : '#c0392b';
      };
      qtyInput.addEventListener('input', () => { line.qty = parseInt(qtyInput.value, 10) || 0; refreshCount(); });
      rateInput.addEventListener('input', () => { line.rate = parseFloat(rateInput.value) || 0; });
      serialsInput.addEventListener('input', () => { line.serialsText = serialsInput.value; refreshCount(); });
      refreshCount();
      linesBody.appendChild(el('tr', {}, [
        el('td', { style: 'width:42%' }, [itemInput,
          itemTitle ? el('div', { style: 'font-size:11px;color:#6b7280;margin-top:3px' }, [itemTitle]) : null].filter(Boolean)),
        el('td', {}, [qtyInput]),
        el('td', {}, [rateInput]),
        el('td', {}, [serialsInput, countNote]),
        el('td', {}, [el('span', {
          style: 'cursor:pointer;color:#c0392b;font-weight:700',
          onclick: () => { lines.splice(idx, 1); if (!lines.length) lines.push(blankLine()); drawLines(); }
        }, ['✕'])])
      ]));
    });
  }

  async function loadFromPo(poId) {
    if (!poId) return;
    const po = await window.api.documents.get(poId);
    if (!po) return;
    if (po.supplier_id) supplierSelect.value = String(po.supplier_id);
    lines = (po.items || []).map(it => ({
      product_id: it.product_id, description: it.description, hsn_sac: it.hsn_sac || '',
      qty: Math.max(1, Math.round(Number(it.qty) || 1)), rate: Number(it.rate) || 0, serialsText: ''
    }));
    if (!lines.length) lines = [blankLine()];
    drawLines();
  }
  poSelect.addEventListener('change', () => loadFromPo(poSelect.value));

  const saveBtn = el('button', { class: 'btn', onclick: async () => {
    const payload = {
      supplier_id: supplierSelect.value ? parseInt(supplierSelect.value, 10) : null,
      po_document_id: poSelect.value ? parseInt(poSelect.value, 10) : null,
      invoice_no: invoiceNoInput.value.trim(),
      invoice_date: invoiceDateInput.value,
      notes: notesInput.value.trim(),
      lines: lines.filter(l => l.description && l.qty > 0).map(l => ({
        product_id: l.product_id, description: l.description, hsn_sac: l.hsn_sac, rate: l.rate,
        qty: l.qty, serials: parseSerials(l.serialsText)
      }))
    };
    if (!payload.supplier_id) { showToast('Select the supplier'); return; }
    if (!payload.invoice_no) { showToast("Enter the supplier's invoice number"); return; }
    if (!payload.lines.length) { showToast('Add at least one item'); return; }
    const bad = payload.lines.find(l => l.serials.length !== l.qty);
    if (bad) { showToast(`"${String(bad.description).split('\n')[0]}": enter exactly ${bad.qty} serial no(s) — one per unit`); return; }
    saveBtn.disabled = true;
    try {
      const saved = await window.api.stock.createPurchaseInvoice(payload);
      overlay.remove();
      showToast(`Invoice ${saved.invoice_no}: ${saved.unit_count} unit(s) added to stock`);
      if (onSaved) onSaved();
    } catch (err) {
      showToast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      saveBtn.disabled = false;
    }
  } }, ['Save & Add to Stock']);

  // Supplier's invoice PDF -> fill the form; the user checks it before saving.
  const pdfNote = el('div', { style: 'font-size:12px;margin:-4px 0 12px' });
  const pdfInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
  const pdfBtn = el('span', { class: 'btn small', onclick: () => pdfInput.click() }, ['📄 Upload Invoice PDF']);
  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files[0];
    pdfInput.value = '';
    if (!file) return;
    pdfBtn.textContent = 'Reading PDF...';
    pdfNote.innerHTML = '';
    try {
      const draft = await window.api.stock.parseInvoicePdf(new Uint8Array(await file.arrayBuffer()));
      if (!draft.lines.length) throw new Error('No items found in this PDF. Please enter the invoice by hand.');
      invoiceNoInput.value = draft.invoice_no || '';
      if (draft.invoice_date) invoiceDateInput.value = draft.invoice_date;
      if (!poSelect.value && draft.po_number) {
        const po = pos.find(p => p.doc_number.toUpperCase() === draft.po_number.toUpperCase());
        if (po) poSelect.value = String(po.id);
      }
      let supplierMsg = null;
      if (draft.supplier_id) supplierSelect.value = String(draft.supplier_id);
      else if (draft.supplier_name) {
        supplierMsg = el('div', { style: 'color:#b45309' }, [
          `Supplier "${draft.supplier_name}" is not in your Suppliers list. `,
          el('span', { class: 'btn small secondary', onclick: async (e) => {
            const s = await window.api.suppliers.create({ name: draft.supplier_name, gstin: draft.supplier_gstin });
            supplierSelect.appendChild(el('option', { value: s.id }, [s.name]));
            supplierSelect.value = String(s.id);
            e.target.closest('div').remove();
            showToast('Supplier added');
          } }, ['+ Add as supplier'])
        ]);
      }
      lines = draft.lines.map(l => ({
        product_id: l.product_id, description: l.product_description || l.description,
        hsn_sac: l.hsn_sac, qty: l.qty, rate: l.rate, serialsText: l.serials.join('\n')
      }));
      drawLines();
      const units = draft.lines.reduce((n, l) => n + l.serials.length, 0);
      const unmatched = draft.lines.filter(l => !l.product_id);
      const short = draft.lines.filter(l => l.serials.length !== l.qty);
      pdfNote.appendChild(el('div', { style: 'color:#15803d;font-weight:600' }, [
        `Read ${file.name}: ${draft.lines.length} item(s), ${units} serial no(s). Check the details, then Save.`]));
      if (supplierMsg) pdfNote.appendChild(supplierMsg);
      if (unmatched.length) pdfNote.appendChild(el('div', { style: 'color:#b45309' }, [
        `Not matched to a product (kept as typed on the invoice): ${unmatched.map(l => l.description).join('; ')}`]));
      if (short.length) pdfNote.appendChild(el('div', { style: 'color:#c0392b' }, [
        `Serial count differs from qty for: ${short.map(l => l.description).join('; ')}`]));
    } catch (err) {
      pdfNote.appendChild(el('div', { style: 'color:#c0392b' }, [
        String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')]));
    } finally {
      pdfBtn.textContent = '📄 Upload Invoice PDF';
    }
  });

  const box = el('div', { class: 'modal-box', style: 'width:920px;max-width:95vw' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('h3', {}, ['Add Purchase Invoice (Goods Received)']), el('div', {}, [pdfBtn, pdfInput])
    ]),
    pdfNote,
    datalist,
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Against Purchase Order']), poSelect]),
      el('div', { class: 'field' }, [el('label', {}, ['Supplier']), supplierSelect])
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Supplier Invoice No']), invoiceNoInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Invoice Date']), invoiceDateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Notes']), notesInput])
    ]),
    el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Item']), el('th', {}, ['Qty']), el('th', {}, ['Purchase Rate']),
        el('th', {}, ['Serial Nos (one per unit)']), el('th', {}, [''])
      ])]),
      linesBody
    ]),
    el('div', { style: 'margin:8px 0 14px' }, [
      el('span', { class: 'btn small secondary', onclick: () => { lines.push(blankLine()); drawLines(); } }, ['+ Add Item'])
    ]),
    el('div', { class: 'btn-row' }, [saveBtn, el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  lines = [blankLine()];
  drawLines();
  if (opts && opts.poId) {
    poSelect.value = String(opts.poId);
    await loadFromPo(opts.poId);
  }
}

// Serial picker for one Tax Invoice / Delivery Challan line. Shows units in stock, units already on this
// document, and (for a Tax Invoice) units sent on a Delivery Challan. onDone(selectedSerials).
async function openSerialPicker({ item, docId, docType }, onDone) {
  const units = await window.api.stock.listUnits('');
  const selected = new Set(item.serial_nos || []);
  const usable = units.filter(u => !u.out_document_id || u.out_document_id === docId || selected.has(u.serial_no) ||
    (u.documents && ((docType === 'tax_invoice' && u.documents.doc_type === 'delivery_challan') ||
                     (docType === 'delivery_challan' && u.documents.doc_type === 'tax_invoice' && selected.has(u.serial_no)))));
  const title = String(item.description || '').split('\n')[0].trim().toLowerCase();
  const matchesItem = (u) => (item.product_id && u.product_id === item.product_id) ||
    (title && String(u.description).split('\n')[0].trim().toLowerCase() === title);

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const searchInput = el('input', { placeholder: 'Search serial no. or item...' });
  const onlyMatching = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  onlyMatching.checked = usable.some(matchesItem);
  const countLabel = el('div', { style: 'font-size:12px;font-weight:600;color:#0e3a5f' });
  const listBox = el('div', { style: 'max-height:50vh;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px' });

  function drawList() {
    listBox.innerHTML = '';
    const q = searchInput.value.trim().toLowerCase();
    const rows = usable.filter(u => (!onlyMatching.checked || matchesItem(u) || selected.has(u.serial_no)) &&
      (!q || u.serial_no.toLowerCase().includes(q) || String(u.description).toLowerCase().includes(q)));
    if (!rows.length) listBox.appendChild(el('div', { class: 'empty-state' }, ['No serial numbers available.']));
    rows.forEach(u => {
      const cb = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      cb.checked = selected.has(u.serial_no);
      cb.addEventListener('change', () => { cb.checked ? selected.add(u.serial_no) : selected.delete(u.serial_no); countLabel.textContent = `${selected.size} selected`; });
      const inv = u.purchase_invoices || {};
      const via = u.documents && u.out_document_id !== docId ? ` · on ${u.documents.doc_number}` : '';
      listBox.appendChild(el('label', { style: 'display:flex;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer' }, [
        cb,
        el('div', {}, [
          el('div', { style: 'font-weight:700' }, [u.serial_no]),
          el('div', { style: 'font-size:11px;color:#6b7280' }, [`${String(u.description).split('\n')[0]} · Inv ${inv.invoice_no || '-'}${via}`])
        ])
      ]));
    });
    countLabel.textContent = `${selected.size} selected`;
  }
  searchInput.addEventListener('input', drawList);
  onlyMatching.addEventListener('change', drawList);

  overlay.appendChild(el('div', { class: 'modal-box', style: 'width:560px' }, [
    el('h3', {}, ['Select Serial Nos']),
    el('div', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px' }, [String(item.description || '').split('\n')[0] || 'Item']),
    el('div', { class: 'search-row' }, [searchInput,
      el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap' }, [onlyMatching, 'Only this item'])]),
    listBox,
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:12px' }, [
      countLabel,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: () => { overlay.remove(); onDone([...selected]); } }, ['Use Selected']),
        el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
      ])
    ])
  ]));
  document.body.appendChild(overlay);
  drawList();
  searchInput.focus();
}
