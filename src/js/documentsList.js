const DOC_TYPE_ORDER = ['quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'purchase_order', 'techno_commercial'];
const DOC_SECTION_TITLES = {
  quotation: 'Quotations', proforma: 'Proforma Invoices',
  tax_invoice: 'Tax Invoices', delivery_challan: 'Delivery Challans',
  purchase_order: 'Purchase Orders', techno_commercial: 'Techno Commercial Offers'
};

// Gates the one truly irreversible action (permanent delete) behind the shared
// delete password, if one has been set in Settings. No-ops straight through
// to onVerified() if no password is configured.
//
// hasDeletePassword() is an async IPC round-trip, so without a guard, clicking
// Delete Permanently on two different rows before the first check resolves
// would open two stacked password modals — whichever wins the race steals
// focus/DOM order, making typing appear to silently fail. The guard makes the
// second click a no-op until the first modal is resolved or dismissed.
let deletePasswordModalOpen = false;
async function requireDeletePassword(onVerified) {
  if (deletePasswordModalOpen) return;
  deletePasswordModalOpen = true;
  let needsPassword;
  try {
    needsPassword = await window.api.security.hasDeletePassword();
  } catch (err) {
    deletePasswordModalOpen = false;
    throw err;
  }
  if (!needsPassword) { deletePasswordModalOpen = false; onVerified(); return; }

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) { overlay.remove(); deletePasswordModalOpen = false; } } });
  const pwInput = el('input', { type: 'password', placeholder: 'Delete password', style: 'flex:1' });
  const showBtn = el('button', {
    class: 'btn secondary small', type: 'button',
    onclick: () => {
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      showBtn.textContent = showing ? 'Show' : 'Hide';
    }
  }, ['Show']);
  const errorBox = el('div', { style: 'color:#c0392b;font-size:12px;margin:-6px 0 8px' });
  const confirmBtn = el('button', { class: 'btn danger', onclick: async () => {
    const ok = await window.api.security.verifyDeletePassword(pwInput.value);
    if (!ok) { errorBox.textContent = 'Incorrect password.'; return; }
    overlay.remove();
    deletePasswordModalOpen = false;
    onVerified();
  } }, ['Confirm Delete']);
  const box = el('div', { class: 'modal-box' }, [
    el('h3', {}, ['Enter Delete Password']),
    el('div', { class: 'field' }, [el('label', {}, ['Password']), el('div', { style: 'display:flex;gap:8px' }, [pwInput, showBtn])]),
    errorBox,
    el('div', { class: 'btn-row' }, [confirmBtn, el('button', { class: 'btn secondary', onclick: () => { overlay.remove(); deletePasswordModalOpen = false; } }, ['Cancel'])])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  pwInput.focus();
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmBtn.click(); });
}

async function renderDocumentsList(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Documents']));

  let showTrash = false;

  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search by number or customer...' });
  searchRow.appendChild(searchInput);
  const trashBtn = el('button', {
    class: 'btn secondary',
    onclick: () => { showTrash = !showTrash; trashBtn.textContent = showTrash ? '📄 Back to Documents' : '🗑 Trash'; load(); }
  }, ['🗑 Trash']);
  searchRow.appendChild(trashBtn);
  searchRow.appendChild(el('button', {
    class: 'btn secondary',
    onclick: async () => {
      const r = await window.api.exportExcel.documents({ search: searchInput.value.trim(), docType: '' });
      if (r.success) showToast('Exported: ' + r.filePath);
    }
  }, ['⬇ Export to Excel']));
  searchRow.appendChild(el('button', { class: 'btn secondary', onclick: openGstr1Modal }, ['📋 GSTR-1 (for Tally / GST filing)']));
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => navigate('document-editor', { docType: 'quotation' }) }, ['+ New Document']));
  root.appendChild(searchRow);

  const listArea = el('div');
  root.appendChild(listArea);

  async function load() {
    listArea.innerHTML = '';

    if (showTrash) {
      const list = await window.api.documents.listDeleted();
      const card = el('div', { class: 'card' });
      listArea.appendChild(card);
      if (list.length === 0) {
        card.appendChild(el('div', { class: 'empty-state' }, ['Trash is empty.']));
        return;
      }
      const table = el('table', { class: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, ['Type']), el('th', {}, ['Number']), el('th', {}, ['Date']),
          el('th', {}, ['Customer']), el('th', {}, ['Branch']), el('th', {}, ['Total']), el('th', {}, [''])
        ])])
      ]);
      const tbody = el('tbody');
      list.forEach(d => {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [badgeFor(d.doc_type)]),
          el('td', {}, [d.doc_number]),
          el('td', {}, [fmtDate(d.doc_date)]),
          el('td', {}, [d.customer_name || d.supplier_name || '-']),
          el('td', {}, [d.branch_name || '-']),
          el('td', {}, [fmtMoney(d.total)]),
          el('td', {}, [el('div', { class: 'btn-row' }, [
            el('span', { class: 'btn small secondary', onclick: async () => {
              await window.api.documents.restore(d.id);
              showToast('Document restored');
              load();
            } }, ['Restore']),
            el('span', { class: 'btn small danger', onclick: async () => {
              if (confirmDialog(`Permanently delete ${d.doc_number}? This cannot be undone.`)) {
                requireDeletePassword(async () => {
                  await window.api.documents.purge(d.id);
                  showToast('Permanently deleted');
                  load();
                });
              }
            } }, ['Delete Permanently'])
          ])])
        ]));
      });
      table.appendChild(tbody);
      card.appendChild(table);
      return;
    }

    const search = searchInput.value.trim();
    const all = await window.api.documents.list({ search, docType: '' });
    if (all.length === 0) {
      listArea.appendChild(el('div', { class: 'card' }, [el('div', { class: 'empty-state' }, ['No documents found.'])]));
      return;
    }

    DOC_TYPE_ORDER.forEach(type => {
      const typeDocs = all.filter(d => d.doc_type === type);
      if (typeDocs.length === 0) return;

      const card = el('div', { class: 'card' }, [
        el('h3', { style: 'margin-top:0;color:#0e3a5f' }, [`${DOC_SECTION_TITLES[type]} (${typeDocs.length})`])
      ]);
      const headerCells = [
        el('th', {}, ['Number']), el('th', {}, ['Date']),
        el('th', {}, [type === 'purchase_order' ? 'Supplier' : 'Customer']), el('th', {}, ['Branch']), el('th', {}, ['Total'])
      ];
      if (type === 'tax_invoice') headerCells.push(el('th', {}, ['Payment']));
      headerCells.push(el('th', {}, ['']));
      const table = el('table', { class: 'data-table' }, [el('thead', {}, [el('tr', {}, headerCells)])]);
      const tbody = el('tbody');
      typeDocs.forEach(d => tbody.appendChild(buildRow(d)));
      table.appendChild(tbody);
      card.appendChild(table);
      listArea.appendChild(card);
    });
  }

  function buildRow(d) {
    const cells = [
      el('td', {}, [d.doc_number]),
      el('td', {}, [fmtDate(d.doc_date)]),
      el('td', {}, [d.customer_name || d.supplier_name || '-']),
      el('td', {}, [d.branch_name || '-']),
      el('td', {}, [fmtMoney(d.total)])
    ];

    if (d.doc_type === 'tax_invoice') {
      const overdue = d.payment_status !== 'paid' && d.due_date && d.due_date < new Date().toISOString().slice(0, 10);
      const label = d.payment_status === 'paid' ? 'Paid' : d.payment_status === 'partial' ? 'Partial' : overdue ? 'Overdue' : 'Unpaid';
      const cls = d.payment_status === 'paid' ? 'paid' : d.payment_status === 'partial' ? 'partial' : overdue ? 'overdue' : 'unpaid';
      const badgeCell = el('td', {}, [el('span', { class: `payment-badge ${cls}` }, [label])]);
      if (d.payment_status === 'paid' || d.payment_status === 'partial') {
        const balance = d.payment_status === 'partial' ? (d.total - (d.payment_amount || 0)) : 0;
        const detailLines = [
          d.payment_date ? `Paid: ${fmtDate(d.payment_date)}` : null,
          d.payment_amount ? `Amt: ${fmtMoney(d.payment_amount)}` : null,
          d.payment_status === 'partial' ? `Balance: ${fmtMoney(balance)}` : null,
          d.payment_reference ? `Ref: ${d.payment_reference}` : null
        ].filter(Boolean);
        if (detailLines.length > 0) {
          badgeCell.appendChild(el('div', { style: 'font-size:10.5px;color:#6b7280;margin-top:3px;line-height:1.5' },
            detailLines.map(line => el('div', {}, [line]))));
        }
      }
      cells.push(badgeCell);
    }

    const actions = [];
    actions.push(el('span', { class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id }) }, ['Open']));
    actions.push(el('span', { class: 'btn small secondary', onclick: async (e) => {
      const btn = e.target;
      const original = btn.textContent;
      btn.textContent = 'Saving...';
      try {
        const r = await downloadDocumentPdf(d.id);
        if (r.success) showToast('PDF saved: ' + r.filePath);
      } finally {
        btn.textContent = original;
      }
    } }, ['⬇ Download']));
    actions.push(el('span', { class: 'btn small secondary', onclick: async () => {
      const r = await downloadDocumentPdf(d.id);
      if (!r.success) return;
      const label = DOC_SECTION_TITLES[d.doc_type] || 'Document';
      window.api.document.openMailto({
        to: (d.customer_snapshot && d.customer_snapshot.email) || '',
        subject: `${label.replace(/s$/, '')} ${d.doc_number}`,
        body: `Please find attached ${label.replace(/s$/, '')} ${d.doc_number}.`
      });
      window.api.document.revealInFolder(r.filePath);
      showToast('PDF saved — attach it in the email that just opened');
    } }, ['✉ Send']));
    if (d.customer_snapshot && d.customer_snapshot.mobile) {
      actions.push(el('span', { class: 'btn small secondary', onclick: () => {
        const digits = d.customer_snapshot.mobile.replace(/\D/g, '');
        const withCountry = digits.length === 10 ? '91' + digits : digits;
        window.api.document.openExternal(`https://wa.me/${withCountry}`);
      } }, ['💬 WhatsApp']));
    }
    if (d.doc_type === 'tax_invoice') {
      if (d.payment_status === 'paid' || d.payment_status === 'partial') {
        actions.push(el('span', {
          class: 'btn small secondary',
          title: [d.payment_date ? `Paid on ${fmtDate(d.payment_date)}` : null,
            d.payment_amount ? `Amount: ${fmtMoney(d.payment_amount)}` : null,
            d.payment_reference ? `Ref: ${d.payment_reference}` : null].filter(Boolean).join(' | '),
          onclick: async () => {
            if (confirmDialog(`Mark ${d.doc_number} back as Unpaid? This clears the recorded payment details.`)) {
              await window.api.documents.setPaymentStatus(d.id, 'unpaid');
              showToast('Marked as Unpaid');
              load();
            }
          }
        }, ['Mark Unpaid']));
      } else {
        actions.push(el('span', { class: 'btn small secondary', onclick: () => openMarkPaidModal(d) }, ['Mark Paid']));
      }
    }
    const nextStage = { quotation: 'proforma', proforma: 'tax_invoice' }[d.doc_type];
    const nextStageLabel = { proforma: 'Proforma', tax_invoice: 'Tax Invoice' };
    if (nextStage) {
      actions.push(el('span', { class: 'btn small', onclick: async () => {
        const created = await window.api.documents.duplicateAs(d.id, nextStage);
        showToast(`Created ${created.doc_number}`);
        navigate('document-editor', { docId: created.id });
      } }, [`→ Convert to ${nextStageLabel[nextStage]}`]));
    }
    if (d.doc_type === 'purchase_order') {
      actions.push(el('span', { class: 'btn small', onclick: () => openPurchaseInvoiceModal({ poId: d.id }) }, ['📥 Receive Goods']));
    }
    if (d.doc_type === 'delivery_challan') {
      // The invoice for this delivery keeps the challan's serial numbers (stock is not deducted twice).
      actions.push(el('span', { class: 'btn small', onclick: async () => {
        const created = await window.api.documents.duplicateAs(d.id, 'tax_invoice');
        showToast(`Created ${created.doc_number}`);
        navigate('document-editor', { docId: created.id });
      } }, ['→ Convert to Tax Invoice']));
    }
    if (d.doc_type === 'quotation' || d.doc_type === 'proforma') {
      actions.push(el('span', { class: 'btn small secondary', onclick: async () => {
        const created = await window.api.documents.duplicateAs(d.id, 'techno_commercial');
        showToast(`Created ${created.doc_number}`);
        navigate('document-editor', { docId: created.id });
      } }, ['→ Convert to Techno Commercial Offer']));
      actions.push(el('span', { class: 'btn small secondary', onclick: async () => {
        const created = await window.api.documents.duplicateAs(d.id, 'purchase_order');
        showToast(`Created ${created.doc_number} — select a supplier and save`);
        navigate('document-editor', { docId: created.id });
      } }, ['→ Create Purchase Order']));
    }
    actions.push(el('span', { class: 'btn small secondary', onclick: () => openDuplicateMenu(d) }, ['Duplicate As...']));
    actions.push(el('span', { class: 'btn small danger', onclick: async () => {
      if (confirmDialog(`Move ${d.doc_number} to Trash?`)) {
        await window.api.documents.delete(d.id);
        showToast('Moved to Trash');
        load();
      }
    } }, ['Delete']));

    return el('tr', {}, [...cells, el('td', {}, [el('div', { class: 'btn-row' }, actions)])]);
  }

  function openGstr1Modal() {
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const fromInput = el('input', { type: 'date', value: monthStart });
    const toInput = el('input', { type: 'date', value: today });
    const box = el('div', { class: 'modal-box' }, [
      el('h3', {}, ['Export GSTR-1 (B2B) Report']),
      el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-8px' }, [
        'Only Tax Invoices with a customer GSTIN are included (B2B) — matches the GST offline utility\'s "b2b" sheet format for direct import into Tally or the GST portal.'
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, ['From']), fromInput]),
        el('div', { class: 'field' }, [el('label', {}, ['To']), toInput])
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: async () => {
          const r = await window.api.exportExcel.gstr1({ from: fromInput.value, to: toInput.value });
          if (r.success) {
            overlay.remove();
            showToast(`Exported: ${r.filePath}` + (r.skippedNoGstin ? ` (${r.skippedNoGstin} invoice(s) skipped — no customer GSTIN)` : ''));
          }
        } }, ['Export']),
        el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
      ])
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openMarkPaidModal(doc) {
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const amountInput = el('input', { type: 'number', step: '0.01', value: doc.total });
    const refInput = el('input', { placeholder: 'UTR / cheque no. / reference (optional)' });
    const box = el('div', { class: 'modal-box' }, [
      el('h3', {}, [`Confirm payment for ${doc.doc_number}`]),
      el('div', { class: 'field' }, [el('label', {}, ['Payment Date']), dateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Amount Received (₹)']), amountInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Reference / UTR No.']), refInput]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: async () => {
          const amount = parseFloat(amountInput.value) || 0;
          const status = amount >= doc.total ? 'paid' : 'partial';
          await window.api.documents.setPaymentStatus(doc.id, status, {
            payment_date: dateInput.value || null,
            payment_amount: amount || null,
            payment_reference: refInput.value.trim() || null
          });
          overlay.remove();
          showToast(status === 'paid' ? 'Marked as Paid' : `Marked as Partially Paid (balance ${fmtMoney(doc.total - amount)})`);
          load();
        } }, ['Confirm Payment']),
        el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
      ])
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openDuplicateMenu(doc) {
    const options = ['quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'techno_commercial'].filter(t => t !== doc.doc_type);
    const labels = { quotation: 'Quotation', proforma: 'Proforma Invoice', tax_invoice: 'Tax Invoice', delivery_challan: 'Delivery Challan', techno_commercial: 'Techno Commercial Offer' };
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const box = el('div', { class: 'modal-box' }, [
      el('h3', {}, [`Duplicate ${doc.doc_number} as...`]),
      el('div', { class: 'btn-row' }, options.map(opt => el('button', {
        class: 'btn secondary',
        onclick: async () => {
          const created = await window.api.documents.duplicateAs(doc.id, opt);
          overlay.remove();
          showToast(`Created ${created.doc_number}`);
          navigate('document-editor', { docId: created.id });
        }
      }, [labels[opt]])))
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  searchInput.addEventListener('input', debounce(load, 250));
  load();
}
