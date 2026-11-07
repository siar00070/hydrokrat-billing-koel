// Stock: serial-numbered units received on supplier purchase invoices (against a PO or direct)
// and taken out by Tax Invoices / Delivery Challans.

const STOCK_OUT_LABEL = { tax_invoice: 'Sold', delivery_challan: 'Delivered' };

function parseSerials(text) {
  return String(text || '').split(/[\n,;]+/).map(s => s.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean);
}

function productLabel(p) {
  return String(p.description || '').split('\n')[0] + (p.spec_model && !String(p.description).includes(p.spec_model) ? ' — ' + p.spec_model : '');
}

// Physically available: not missing, replaced or written off.
function isUnitAvailable(u) {
  return !u.issue_status || u.issue_status === 'received';
}

function stockErrorText(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// Small form dialog. fields: [{ key, label, type, value, placeholder, min, max }]; onSubmit(values) may throw.
function openStockDialog({ title, intro, fields, submitLabel }, onSubmit) {
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const inputs = {};
  const errorBox = el('div', { style: 'color:#c0392b;font-size:12px;margin-bottom:8px' });
  const rows = fields.map(f => {
    inputs[f.key] = el('input', {
      type: f.type || 'text', value: f.value === undefined ? '' : f.value, placeholder: f.placeholder || '',
      ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {})
    });
    return el('div', { class: 'field' }, [el('label', {}, [f.label]), inputs[f.key]]);
  });
  const submit = el('button', { class: 'btn', onclick: async () => {
    const values = {};
    Object.keys(inputs).forEach(k => { values[k] = inputs[k].value.trim(); });
    submit.disabled = true;
    errorBox.textContent = '';
    try {
      await onSubmit(values);
      overlay.remove();
    } catch (err) {
      errorBox.textContent = stockErrorText(err);
      submit.disabled = false;
    }
  } }, [submitLabel || 'Save']);
  overlay.appendChild(el('div', { class: 'modal-box' }, [
    el('h3', {}, [title]),
    intro ? el('div', { style: 'font-size:12.5px;color:#374151;margin-bottom:12px' }, [intro]) : null,
    ...rows,
    errorBox,
    el('div', { class: 'btn-row' }, [submit, el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])])
  ].filter(Boolean)));
  document.body.appendChild(overlay);
  if (fields.length) inputs[fields[0].key].focus();
}

function buildStockListHtml(rows) {
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const totalQty = rows.reduce((n, r) => n + r.qty, 0);
  const totalMissing = rows.reduce((n, r) => n + r.missing, 0);
  const line = (r) => `<tr>
    <td>${esc(r.description)}</td>
    <td>${esc(r.hsn_sac)}</td>
    <td class="num">${r.qty}</td>
    <td class="num missing">${r.missing || ''}</td>
    <td class="serials">${r.no_serial ? '<span class="muted">No serial no.</span>' : esc(r.serials.join(', '))}</td>
  </tr>`;
  // Items grouped under the catalogue sections (Borewell, Openwell ...), with a heading per size where there are several.
  const body = groupStockRows(rows).map(sec => `<tr class="sec"><td>${esc(sec.section)}</td><td></td><td class="num">${sec.qty}</td><td class="num missing">${sec.missing || ''}</td><td></td></tr>`
    + sec.groups.map(g => (g.sub ? `<tr class="sub"><td colspan="5">${esc(g.sub)}</td></tr>` : '') + g.rows.map(line).join('')).join('')).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Stock List</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .head img { height: 44px; }
    h1 { font-size: 18px; color: #0e3a5f; margin: 0; text-align: right; }
    .date { text-align: right; color: #6b7280; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th { background: #0e3a5f; color: #fff; text-align: left; padding: 6px 8px; font-size: 10.5px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; }
    tr { page-break-inside: avoid; }
    .num { text-align: right; white-space: nowrap; }
    .missing { color: #c0392b; font-weight: 700; }
    .serials { font-size: 9.5px; }
    .muted { color: #6b7280; }
    .sec td { background: #e2ece8; font-weight: 700; font-size: 12px; border-top: 6px solid #fff; page-break-after: avoid; }
    .sub td { color: #1f7a5c; font-weight: 700; font-size: 10px; letter-spacing: .4px; text-transform: uppercase; padding-left: 16px; page-break-after: avoid; }
    .total td { font-weight: 700; border-top: 2px solid #0e3a5f; }
  </style></head><body>
    <div class="head">
      ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" alt="Hydrokrat Ventures">` : ''}
      <div><h1>Stock List</h1><div class="date">As on ${esc(today)}</div></div>
    </div>
    <table>
      <colgroup><col style="width:36%"><col style="width:8%"><col style="width:6%"><col style="width:6%"><col style="width:44%"></colgroup>
      <thead><tr><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Missing</th><th>Serial Nos</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5">Nothing in stock.</td></tr>'}
        <tr class="total"><td>Total</td><td></td><td class="num">${totalQty}</td><td class="num missing">${totalMissing || ''}</td><td></td></tr>
      </tbody>
    </table>
  </body></html>`;
}

async function renderStock(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Stock']));

  const tabs = [['instock', 'Inventory'], ['serials', 'All Serial Nos'], ['missing', '⚠️ Missing'], ['invoices', 'Purchase Invoices']];
  let active = 'instock';
  const openStockSections = new Set();   // Inventory sections the user has opened
  const tabRow = el('div', { class: 'btn-row', style: 'margin-bottom:14px' });
  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search serial no. or item...' });
  searchRow.appendChild(searchInput);
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => openPurchaseInvoiceModal({}, load) }, ['+ Add Purchase Invoice']));
  searchRow.appendChild(el('button', { class: 'btn secondary', onclick: async () => {
    try {
      const r = await window.api.stock.exportExcel();
      if (r.success) showToast('Excel saved: ' + r.filePath);
    } catch (err) { showToast(stockErrorText(err)); }
  } }, ['⬇️ Excel']));
  searchRow.appendChild(el('button', { class: 'btn secondary', onclick: async () => {
    try {
      const rows = await window.api.stock.getList();
      const date = new Date().toISOString().slice(0, 10);
      const r = await window.api.document.savePdf(buildStockListHtml(rows), `Stock List ${date}`, 'stock_list');
      if (r.success) showToast('PDF saved: ' + r.filePath);
    } catch (err) { showToast(stockErrorText(err)); }
  } }, ['⬇️ PDF']));
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
    const search = searchInput.value.trim();
    const units = await window.api.stock.listUnits(search);
    if (active === 'instock') {
      const qtyRows = (await window.api.stock.listQty())
        .filter(r => (r.balance > 0 || r.missing > 0) && String(r.description).toLowerCase().includes(search.toLowerCase()));
      drawInStock(units.filter(u => !u.out_document_id && (isUnitAvailable(u) || u.issue_status === 'missing')), qtyRows);
    } else if (active === 'missing') {
      const lots = (await window.api.stock.listLots())
        .filter(l => Number(l.short_qty) > 0 && String(l.description).toLowerCase().includes(search.toLowerCase()));
      drawMissing(units.filter(u => u.issue_status === 'missing'), lots);
    } else drawSerials(units);
  }

  function missingTag(n) {
    return n > 0 ? el('span', { style: 'color:#c0392b;font-weight:700;margin-left:8px;white-space:nowrap' }, [`⚠️ ${n} missing`]) : null;
  }

  function resolveActions(u) {
    return el('div', { class: 'btn-row' }, [
      el('span', { class: 'btn small', onclick: () => {
        if (!confirmDialog(`Mark ${u.serial_no} as received? It goes back into stock.`)) return;
        runAction(() => window.api.stock.resolveUnit(u.id, 'received'), `${u.serial_no} is back in stock`);
      } }, ['✅ Received']),
      el('span', { class: 'btn small secondary', onclick: () => openStockDialog({
        title: 'Replace Pump',
        intro: `${u.serial_no} will stay on record as replaced. The new pump goes into stock on the same purchase invoice.`,
        fields: [{ key: 'serial', label: 'New Serial No', placeholder: 'Serial number of the replacement' }],
        submitLabel: 'Replace'
      }, async (v) => {
        const created = await window.api.stock.replaceUnit(u.id, v.serial);
        showToast(`${created.serial_no} added to stock`);
        load();
      }) }, ['🔁 Replace']),
      el('span', { class: 'btn small danger', onclick: () => {
        if (!confirmDialog(`Write off ${u.serial_no}? Use this when the pump will never come, e.g. a credit note was given. It cannot be undone.`)) return;
        runAction(() => window.api.stock.resolveUnit(u.id, 'written_off'), `${u.serial_no} written off`);
      } }, ['❌ Write Off'])
    ]);
  }

  async function runAction(action, message) {
    try {
      await action();
      showToast(message);
      load();
    } catch (err) {
      showToast(stockErrorText(err));
    }
  }

  function drawMissing(units, lots) {
    if (units.length === 0 && lots.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['Nothing is missing. 👍']));
      return;
    }
    const tbody = el('tbody');
    units.forEach(u => {
      const inv = u.purchase_invoices || {};
      tbody.appendChild(el('tr', { style: 'background:#fef2f2' }, [
        el('td', { style: 'font-weight:700' }, [u.serial_no]),
        el('td', {}, [String(u.description).split('\n')[0]]),
        el('td', {}, [inv.invoice_no || '-', el('div', { style: 'font-size:11px;color:#6b7280' }, [inv.supplier_snapshot ? inv.supplier_snapshot.name : ''])]),
        el('td', { style: 'font-size:12px' }, [u.issue_note || '-', el('div', { style: 'font-size:11px;color:#6b7280' }, [u.issue_date ? 'Since ' + fmtDate(u.issue_date) : ''])]),
        el('td', {}, [resolveActions(u)])
      ]));
    });
    lots.forEach(l => {
      const inv = l.purchase_invoices || {};
      const pending = Number(l.short_qty);
      const resolveLot = (action, title, label) => openStockDialog({
        title,
        intro: `${String(l.description).split('\n')[0]}: ${pending} short`,
        fields: [{ key: 'qty', label: 'How many?', type: 'number', value: pending, min: 1, max: pending }],
        submitLabel: label
      }, async (v) => {
        await window.api.stock.resolveLotShort(l.id, action, Number(v.qty));
        showToast('Stock updated');
        load();
      });
      tbody.appendChild(el('tr', { style: 'background:#fef2f2' }, [
        el('td', { style: 'font-weight:700' }, [`${pending} short`]),
        el('td', {}, [String(l.description).split('\n')[0]]),
        el('td', {}, [inv.invoice_no || '-', el('div', { style: 'font-size:11px;color:#6b7280' }, [inv.supplier_snapshot ? inv.supplier_snapshot.name : ''])]),
        el('td', { style: 'font-size:12px' }, [l.short_note || '-', el('div', { style: 'font-size:11px;color:#6b7280' }, [l.short_date ? 'Since ' + fmtDate(l.short_date) : ''])]),
        el('td', {}, [el('div', { class: 'btn-row' }, [
          el('span', { class: 'btn small', onclick: () => resolveLot('received', 'Mark Received', 'Received') }, ['✅ Received']),
          el('span', { class: 'btn small danger', onclick: () => resolveLot('written_off', 'Write Off', 'Write Off') }, ['❌ Write Off'])
        ])])
      ]));
    });
    card.appendChild(el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Serial No / Qty']), el('th', {}, ['Item']), el('th', {}, ['Purchase Invoice']),
        el('th', {}, ['Note']), el('th', {}, [''])
      ])]),
      tbody
    ]));
  }

  function drawInStock(units, qtyRows) {
    if (units.length === 0 && qtyRows.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['Nothing in stock. Use "+ Add Purchase Invoice" to receive goods.']));
      return;
    }
    const groups = new Map();
    units.forEach(u => {
      const key = u.product_id ? 'p' + u.product_id : 'd' + u.description;
      if (!groups.has(key)) groups.set(key, { description: u.description, units: [], missing: 0 });
      if (u.issue_status === 'missing') groups.get(key).missing++;
      else groups.get(key).units.push(u);
    });
    // One row per item; the rows are then sorted into the catalogue sections (Borewell, Openwell ...).
    const entries = [];
    [...groups.values()].forEach(g => {
      const name = String(g.description).split('\n')[0];
      entries.push({ name, cells: [
        el('td', { style: 'text-align:center;font-weight:700' }, [String(g.units.length)]),
        el('td', { style: 'font-size:12px' }, [g.units.map(u => u.serial_no).join(', '), missingTag(g.missing)])
      ] });
    });
    qtyRows.forEach(r => {
      const name = String(r.description).split('\n')[0];
      entries.push({ name, cells: [
        el('td', { style: 'text-align:center;font-weight:700' }, [String(Math.max(0, r.balance))]),
        el('td', { style: 'font-size:12px;color:#6b7280' }, ['No serial no.', missingTag(r.missing)])
      ] });
    });
    const bySection = new Map();
    entries.forEach(e => {
      e.section = productSection(e.name);
      e.sub = productSubheading(e.section, e.name);
      if (!bySection.has(e.section)) bySection.set(e.section, []);
      bySection.get(e.section).push(e);
    });
    const natural = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true });
    const searching = !!searchInput.value.trim();
    const tbody = el('tbody');
    PRODUCT_SECTIONS.filter(sec => bySection.has(sec)).forEach(sec => {
      const list = bySection.get(sec).sort((x, y) => natural(x.sub, y.sub) || natural(x.name, y.name));
      const isOpen = searching || openStockSections.has(sec);
      const qty = list.reduce((n, e) => n + (parseInt(e.cells[0].textContent, 10) || 0), 0);
      tbody.appendChild(el('tr', { class: 'section-row', onclick: () => {
        if (openStockSections.has(sec)) openStockSections.delete(sec); else openStockSections.add(sec);
        load();
      } }, [el('td', { colspan: '4' }, [
        el('span', { class: 'sec-chev' }, [isOpen ? '▼' : '▶']), ' ', el('span', { class: 'sec-name' }, [sec]),
        el('span', { class: 'sec-count' }, [`${qty} unit${qty === 1 ? '' : 's'} in stock`])
      ])]));
      if (!isOpen) return;
      const manySubs = new Set(list.map(e => e.sub)).size > 1;
      let lastSub = null;
      list.forEach(e => {
        if (manySubs && e.sub && e.sub !== lastSub) {
          tbody.appendChild(el('tr', { class: 'sub-row' }, [el('td', { colspan: '4' }, [e.sub])]));
          lastSub = e.sub;
        }
        const photo = productPhoto(e.name);
        tbody.appendChild(el('tr', {}, [
          el('td', { class: 'col-photo' }, photo ? [el('img', {
            class: 'product-photo', src: photo, alt: '', title: 'Click to enlarge', onclick: () => showProductPhoto(photo, e.name)
          })] : []),
          el('td', {}, [e.name]), ...e.cells
        ]));
      });
    });
    const total = [...groups.values()].reduce((n, g) => n + g.units.length, 0) + qtyRows.reduce((n, r) => n + Math.max(0, r.balance), 0);
    card.appendChild(el('div', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px' }, [`${total} unit(s) in stock`]));
    card.appendChild(el('table', { class: 'data-table products-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { class: 'col-photo' }, ['']), el('th', {}, ['Item']), el('th', {}, ['Qty']), el('th', {}, ['Serial Nos'])])]),
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
      const closed = u.issue_status === 'replaced' || u.issue_status === 'written_off';
      const rowStyle = u.issue_status === 'missing' ? 'background:#fef2f2' : (closed ? 'color:#9ca3af' : '');
      let status;
      if (u.issue_status === 'missing') {
        status = el('div', {}, [
          el('span', { class: 'badge', style: 'background:#c0392b' }, ['⚠️ Missing']),
          el('div', { style: 'font-size:11px;margin:3px 0 5px' }, [`${u.issue_note || ''}${u.issue_date ? ' (since ' + fmtDate(u.issue_date) + ')' : ''}`]),
          resolveActions(u)
        ]);
      } else if (u.issue_status === 'replaced') {
        status = el('div', { style: 'font-size:12px' }, [`Replaced by ${u.replaced_by_serial}`]);
      } else if (u.issue_status === 'written_off') {
        status = el('div', { style: 'font-size:12px' }, [`Written off${u.issue_note ? ': ' + u.issue_note : ''}`]);
      } else if (out) {
        status = el('span', {
          class: `badge ${out.doc_type}`, style: 'cursor:pointer',
          onclick: () => navigate('document-editor', { docId: out.id })
        }, [`${STOCK_OUT_LABEL[out.doc_type] || 'Out'}: ${out.doc_number}`]);
      } else {
        status = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
          el('span', { style: 'color:#15803d;font-weight:600' }, ['In stock']),
          el('span', { class: 'btn small secondary', onclick: () => openStockDialog({
            title: 'Mark Missing',
            intro: `${u.serial_no} will not be counted in Inventory and cannot be sold until it is received.`,
            fields: [{ key: 'note', label: 'Note', placeholder: 'e.g. Short from KOEL Ahmedabad, they will recover and send' }],
            submitLabel: 'Mark Missing'
          }, async (v) => {
            await window.api.stock.markUnitMissing(u.id, v.note);
            showToast(`${u.serial_no} marked missing`);
            load();
          }) }, ['⚠️ Mark Missing'])
        ]);
      }
      const history = [
        u.replaces_serial ? `Replaces ${u.replaces_serial}` : null,
        u.issue_status === 'received' ? `Was missing${u.issue_note ? ': ' + u.issue_note : ''}` : null
      ].filter(Boolean).join(' · ');
      tbody.appendChild(el('tr', { style: rowStyle }, [
        el('td', { style: `font-weight:600${closed ? ';text-decoration:line-through' : ''}` }, [u.serial_no]),
        el('td', {}, [String(u.description).split('\n')[0]]),
        el('td', {}, [`${inv.invoice_no || '-'}${inv.invoice_date ? ' (' + fmtDate(inv.invoice_date) + ')' : ''}`]),
        el('td', {}, [inv.supplier_snapshot ? inv.supplier_snapshot.name : '-']),
        el('td', {}, [status, history ? el('div', { style: 'font-size:11px;color:#6b7280;margin-top:3px' }, [history]) : null].filter(Boolean))
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

  // Quantity-only lines of one invoice: choose the line, how many are short and a note.
  async function openMarkShort(inv) {
    const lots = (await window.api.stock.listLots()).filter(l => l.purchase_invoice_id === inv.id);
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const rows = lots.map(l => {
      const qtyInput = el('input', { type: 'number', min: '0', step: '1', value: '0', style: 'width:80px' });
      const noteInput = el('input', { placeholder: 'Note (optional)' });
      const arrived = Number(l.qty) - (Number(l.short_qty) || 0) - (Number(l.short_written_off) || 0);
      return { l, qtyInput, noteInput, row: el('tr', {}, [
        el('td', { style: 'font-size:12px' }, [String(l.description).split('\n')[0],
          el('div', { style: 'font-size:11px;color:#6b7280' }, [`${arrived} received${Number(l.short_qty) ? ', ' + Number(l.short_qty) + ' already short' : ''}`])]),
        el('td', {}, [qtyInput]),
        el('td', {}, [noteInput])
      ]) };
    });
    const errorBox = el('div', { style: 'color:#c0392b;font-size:12px;margin:8px 0' });
    overlay.appendChild(el('div', { class: 'modal-box', style: 'width:720px;max-width:95vw' }, [
      el('h3', {}, [`Mark Short — Invoice ${inv.invoice_no}`]),
      el('table', { class: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Item']), el('th', {}, ['Short Qty']), el('th', {}, ['Note'])])]),
        el('tbody', {}, rows.map(r => r.row))
      ]),
      errorBox,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: async () => {
          try {
            const chosen = rows.filter(r => Number(r.qtyInput.value) > 0);
            if (!chosen.length) { errorBox.textContent = 'Enter how many are short'; return; }
            for (const r of chosen) await window.api.stock.markLotShort(r.l.id, Number(r.qtyInput.value), r.noteInput.value.trim());
            overlay.remove();
            showToast('Marked short');
            load();
          } catch (err) {
            errorBox.textContent = stockErrorText(err);
          }
        } }, ['Mark Short']),
        el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
      ])
    ]));
    document.body.appendChild(overlay);
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
        el('td', {}, [[
          inv.unit_count ? `${inv.in_stock_count} / ${inv.unit_count} in stock` : null,
          inv.qty_only_count ? `${inv.qty_only_count} without serial no.` : null
        ].filter(Boolean).join(', '), missingTag(inv.missing_count)]),
        el('td', {}, [el('div', { class: 'btn-row' }, [
          inv.qty_only_count ? el('span', { class: 'btn small secondary', onclick: () => openMarkShort(inv) }, ['⚠️ Mark Short']) : null,
          el('span', { class: 'btn small danger', onclick: async () => {
            if (!confirmDialog(`Delete purchase invoice ${inv.invoice_no} and its ${inv.unit_count + inv.qty_only_count} unit(s) from stock?`)) return;
            await window.api.stock.deletePurchaseInvoice(inv.id);
            showToast('Purchase invoice deleted');
            load();
          } }, ['Delete'])
        ].filter(Boolean))])
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

  function blankLine() { return { product_id: null, description: '', hsn_sac: '', qty: 1, rate: 0, serialsText: '', noSerial: false, hasMissing: false, missingText: '', shortQty: 0, issueNote: '' }; }

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
        if (line.noSerial) { countNote.textContent = ''; return; }
        const n = parseSerials(line.serialsText).length;
        countNote.textContent = `${n} / ${line.qty} serial no(s)`;
        countNote.style.color = n === line.qty ? '#15803d' : '#c0392b';
      };
      qtyInput.addEventListener('input', () => { line.qty = parseInt(qtyInput.value, 10) || 0; refreshCount(); });
      rateInput.addEventListener('input', () => { line.rate = parseFloat(rateInput.value) || 0; });
      serialsInput.addEventListener('input', () => { line.serialsText = serialsInput.value; refreshCount(); });
      refreshCount();
      const noSerialInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      noSerialInput.checked = !!line.noSerial;
      noSerialInput.addEventListener('change', () => { line.noSerial = noSerialInput.checked; drawLines(); });
      const noSerialLabel = el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:11.5px;color:#6b7280;margin-top:4px;cursor:pointer' }, [noSerialInput, 'No serial no. (stock by quantity)']);
      // Billed but not physically received: which serials (or how many, for quantity-only items) and why.
      const missingToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      missingToggle.checked = !!line.hasMissing;
      missingToggle.addEventListener('change', () => { line.hasMissing = missingToggle.checked; drawLines(); });
      const missingLabel = el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:11.5px;color:#c0392b;margin-top:4px;cursor:pointer' }, [missingToggle, line.noSerial ? '⚠️ Some are short' : '⚠️ Some pumps are missing']);
      let missingFields = null;
      if (line.hasMissing) {
        const noteInput = el('input', { value: line.issueNote || '', placeholder: 'Note, e.g. short from KOEL Ahmedabad' });
        noteInput.addEventListener('input', () => { line.issueNote = noteInput.value; });
        let whichInput;
        if (line.noSerial) {
          whichInput = el('input', { type: 'number', min: '1', step: '1', value: line.shortQty || '', placeholder: 'How many are short' });
          whichInput.addEventListener('input', () => { line.shortQty = parseInt(whichInput.value, 10) || 0; });
        } else {
          whichInput = el('textarea', { rows: 2, placeholder: 'Missing serial no(s), copied from the list above' }, [line.missingText]);
          whichInput.addEventListener('input', () => { line.missingText = whichInput.value; });
        }
        missingFields = el('div', { style: 'margin-top:4px;display:flex;flex-direction:column;gap:4px' }, [whichInput, noteInput]);
      }
      linesBody.appendChild(el('tr', {}, [
        el('td', { style: 'width:42%' }, [itemInput,
          itemTitle ? el('div', { style: 'font-size:11px;color:#6b7280;margin-top:3px' }, [itemTitle]) : null,
          // Pumps with serial numbers must be linked to a product, or dealers see them under "Other".
          (itemTitle && !line.product_id && !line.noSerial)
            ? el('div', { style: 'font-size:11.5px;color:#c0392b;font-weight:600;margin-top:3px' }, ['Not in your product list. Pick the right model from the list above.'])
            : null].filter(Boolean)),
        el('td', {}, [qtyInput]),
        el('td', {}, [rateInput]),
        el('td', {}, line.noSerial
          ? [el('div', { style: 'font-size:12px;font-weight:600;color:#0e3a5f' }, [`Quantity only: ${line.qty} unit(s)`]), noSerialLabel, missingLabel, missingFields].filter(Boolean)
          : [serialsInput, countNote, noSerialLabel, missingLabel, missingFields].filter(Boolean)),
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
        qty: l.qty, no_serial: !!l.noSerial, serials: l.noSerial ? [] : parseSerials(l.serialsText),
        missing_serials: l.hasMissing && !l.noSerial ? parseSerials(l.missingText) : [],
        short_qty: l.hasMissing && l.noSerial ? l.shortQty : 0,
        issue_note: l.hasMissing ? (l.issueNote || '').trim() : ''
      }))
    };
    if (!payload.supplier_id) { showToast('Select the supplier'); return; }
    if (!payload.invoice_no) { showToast("Enter the supplier's invoice number"); return; }
    if (!payload.lines.length) { showToast('Add at least one item'); return; }
    const bad = payload.lines.find(l => !l.no_serial && l.serials.length !== l.qty);
    if (bad) { showToast(`"${String(bad.description).split('\n')[0]}": enter exactly ${bad.qty} serial no(s), or tick "No serial no."`); return; }
    const unlinked = payload.lines.filter(l => !l.product_id && !l.no_serial);
    if (unlinked.length && !confirmDialog(
      `${unlinked.length} item(s) are not in your product list:\n\n` +
      unlinked.map(l => '• ' + String(l.description).split('\n')[0]).join('\n') +
      '\n\nDealers will see them under "Other", and they will not match a catalogue model.\n\nSave anyway?')) {
      return;
    }
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
        hsn_sac: l.hsn_sac, qty: l.qty, rate: l.rate, serialsText: l.serials.join('\n'), noSerial: l.serials.length === 0
      }));
      drawLines();
      const units = draft.lines.reduce((n, l) => n + l.serials.length, 0);
      const noSerial = draft.lines.filter(l => l.serials.length === 0);
      const unmatched = draft.lines.filter(l => !l.product_id && l.serials.length > 0);
      const newProducts = noSerial.filter(l => !l.product_id);
      const short = draft.lines.filter(l => l.serials.length > 0 && l.serials.length !== l.qty);
      pdfNote.appendChild(el('div', { style: 'color:#15803d;font-weight:600' }, [
        `Read ${file.name}: ${draft.lines.length} item(s), ${units} serial no(s)${noSerial.length ? `, ${noSerial.length} item(s) with no serial no` : ''}. Check the details, then Save.`]));
      const pumpsNoSerial = noSerial.filter(l => String(l.hsn_sac).startsWith('841370'));
      if (pumpsNoSerial.length) pdfNote.appendChild(el('div', { style: 'color:#c0392b;font-weight:600' }, [
        `Check: no serial nos found for these pumps — ${pumpsNoSerial.map(l => l.description).join('; ')}`]));
      if (newProducts.length) pdfNote.appendChild(el('div', { style: 'color:#0e3a5f' }, [
        `${newProducts.length} new item(s) will be added to Products when you save.`]));
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
  const usable = units.filter(isUnitAvailable).filter(u => !u.out_document_id || u.out_document_id === docId || selected.has(u.serial_no) ||
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
