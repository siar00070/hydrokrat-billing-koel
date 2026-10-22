async function renderDashboard(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Dashboard']));

  const quickCreate = el('div', { class: 'quick-create-grid' }, [
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'quotation' }) }, [
      el('div', { class: 'icon' }, ['📝']),
      el('div', { class: 'title' }, ['New Quotation']),
      el('div', { class: 'sub' }, ['Create a price quotation'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'proforma' }) }, [
      el('div', { class: 'icon' }, ['📃']),
      el('div', { class: 'title' }, ['New Proforma Invoice']),
      el('div', { class: 'sub' }, ['Advance payment / order confirmation'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'tax_invoice' }) }, [
      el('div', { class: 'icon' }, ['🧾']),
      el('div', { class: 'title' }, ['New Tax Invoice']),
      el('div', { class: 'sub' }, ['GST tax invoice for sales'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'delivery_challan' }) }, [
      el('div', { class: 'icon' }, ['🚚']),
      el('div', { class: 'title' }, ['New Delivery Challan']),
      el('div', { class: 'sub' }, ['Goods in transit, with vehicle details'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'purchase_order' }) }, [
      el('div', { class: 'icon' }, ['🏭']),
      el('div', { class: 'title' }, ['New Purchase Order']),
      el('div', { class: 'sub' }, ['Order goods from a supplier'])
    ]),
    el('div', { class: 'quick-create-card', onclick: () => navigate('document-editor', { docType: 'techno_commercial' }) }, [
      el('div', { class: 'icon' }, ['📑']),
      el('div', { class: 'title' }, ['New Techno Commercial Offer']),
      el('div', { class: 'sub' }, ['Technical + commercial offer'])
    ])
  ]);
  root.appendChild(el('div', { class: 'card' }, [quickCreate]));

  const summary = await window.api.documents.monthlySummary();

  const summaryCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['This Month']),
    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.total)]), el('div', { class: 'stat-label' }, ['Total Billed'])]),
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.cgst + summary.sgst + summary.igst)]), el('div', { class: 'stat-label' }, ['GST Collected'])]),
      el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(summary.count)]), el('div', { class: 'stat-label' }, ['Tax Invoices'])])
    ]),
    summary.topCustomers.length > 0 ? el('div', { style: 'margin-top:12px' }, [
      el('div', { style: 'font-size:11px;color:#6b7280;font-weight:600;margin-bottom:6px' }, ['TOP CUSTOMERS']),
      ...summary.topCustomers.map(c => el('div', { class: 'mini-row' }, [
        el('span', {}, [c.name]), el('span', {}, [fmtMoney(c.total)])
      ]))
    ]) : null
  ].filter(Boolean));
  root.appendChild(summaryCard);

  if (summary.outstanding.length > 0) {
    const outstandingCard = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Outstanding Payments']),
      el('div', { class: 'stat-row' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [fmtMoney(summary.outstandingTotal)]), el('div', { class: 'stat-label' }, ['Total Unpaid'])]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value', style: summary.overdueTotal > 0 ? 'color:#c0392b' : '' }, [fmtMoney(summary.overdueTotal)]), el('div', { class: 'stat-label' }, ['Overdue'])])
      ])
    ]);
    const table = el('table', { class: 'data-table', style: 'margin-top:10px' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Number']), el('th', {}, ['Customer']), el('th', {}, ['Due Date']), el('th', {}, ['Amount']), el('th', {}, [''])])])
    ]);
    const tbody = el('tbody');
    summary.outstanding.forEach(d => {
      const badgeCls = d.overdue ? 'overdue' : d.partial ? 'partial' : 'unpaid';
      const badgeLabel = d.overdue ? 'Overdue' : d.partial ? 'Partial' : 'Unpaid';
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [d.doc_number]),
        el('td', {}, [d.customer_name || '-']),
        el('td', {}, [d.due_date ? fmtDate(d.due_date) : '-']),
        el('td', {}, [fmtMoney(d.balance) + (d.partial ? ` (of ${fmtMoney(d.total)})` : '')]),
        el('td', {}, [
          el('span', { class: `payment-badge ${badgeCls}` }, [badgeLabel]),
          ' ',
          el('span', { class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id }) }, ['Open'])
        ])
      ]));
    });
    table.appendChild(tbody);
    outstandingCard.appendChild(table);
    root.appendChild(outstandingCard);
  }

  if (summary.quotationFollowUps && summary.quotationFollowUps.length > 0) {
    const followUpCard = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Quotations Needing Follow-up']),
      el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-6px' }, ['Expiring within 7 days or already past their Valid Until date.'])
    ]);
    const table = el('table', { class: 'data-table', style: 'margin-top:6px' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Number']), el('th', {}, ['Customer']), el('th', {}, ['Valid Until']), el('th', {}, ['Amount']), el('th', {}, [''])])])
    ]);
    const tbody = el('tbody');
    summary.quotationFollowUps.forEach(d => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [d.doc_number]),
        el('td', {}, [d.customer_name || '-']),
        el('td', {}, [
          fmtDate(d.valid_until),
          d.expired ? el('span', { class: 'payment-badge overdue', style: 'margin-left:6px' }, ['Expired']) : el('span', { class: 'payment-badge unpaid', style: 'margin-left:6px' }, ['Expiring soon'])
        ]),
        el('td', {}, [fmtMoney(d.total)]),
        el('td', {}, [el('span', { class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id }) }, ['Open'])])
      ]));
    });
    table.appendChild(tbody);
    followUpCard.appendChild(table);
    root.appendChild(followUpCard);
  }

  const docs = await window.api.documents.list({});
  if (docs.length === 0) {
    root.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'empty-state' }, ['No documents yet. Create your first one above.'])
    ]));
    return;
  }

  const recentTitles = { quotation: 'Recent Quotations', proforma: 'Recent Proforma Invoices', tax_invoice: 'Recent Tax Invoices', delivery_challan: 'Recent Delivery Challans', purchase_order: 'Recent Purchase Orders', techno_commercial: 'Recent Techno Commercial Offers' };
  let activeRecentType = 'quotation';

  const tabRow = el('div', { class: 'btn-row', style: 'margin-bottom:10px' });
  const recentCard = el('div', { class: 'card' });

  function renderRecentTabs() {
    tabRow.innerHTML = '';
    ['quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'purchase_order', 'techno_commercial'].forEach(type => {
      tabRow.appendChild(el('button', {
        class: `btn small ${type === activeRecentType ? '' : 'secondary'}`,
        onclick: () => { activeRecentType = type; renderRecentTabs(); renderRecentTable(); }
      }, [recentTitles[type].replace('Recent ', '')]));
    });
  }

  function renderRecentTable() {
    recentCard.innerHTML = '';
    recentCard.appendChild(el('h3', { style: 'margin-top:0;color:#0e3a5f' }, [recentTitles[activeRecentType]]));
    const typeDocs = docs.filter(d => d.doc_type === activeRecentType).slice(0, 8);
    if (typeDocs.length === 0) {
      recentCard.appendChild(el('div', { class: 'empty-state' }, ['None yet.']));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Number']), el('th', {}, ['Date']), el('th', {}, ['Customer']), el('th', {}, ['Total']), el('th', {}, [''])])])
    ]);
    const tbody = el('tbody');
    typeDocs.forEach(d => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [d.doc_number]),
        el('td', {}, [fmtDate(d.doc_date)]),
        el('td', {}, [d.customer_name || d.supplier_name || '-']),
        el('td', {}, [fmtMoney(d.total)]),
        el('td', {}, [el('span', {
          class: 'btn small secondary', onclick: () => navigate('document-editor', { docId: d.id })
        }, ['Open'])])
      ]));
    });
    table.appendChild(tbody);
    recentCard.appendChild(table);
  }

  renderRecentTabs();
  renderRecentTable();
  root.appendChild(tabRow);
  root.appendChild(recentCard);
}

function badgeFor(docType) {
  const labels = { quotation: 'Quotation', proforma: 'Proforma', tax_invoice: 'Tax Invoice', delivery_challan: 'Delivery Challan', purchase_order: 'Purchase Order', techno_commercial: 'Techno Commercial' };
  return el('span', { class: `badge ${docType}` }, [labels[docType] || docType]);
}
