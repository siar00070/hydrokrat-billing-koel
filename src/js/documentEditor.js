const DOC_TYPE_LABELS = { quotation: 'Quotation', proforma: 'Proforma Invoice', tax_invoice: 'Tax Invoice', delivery_challan: 'Delivery Challan', purchase_order: 'Purchase Order', techno_commercial: 'Techno Commercial Offer' };
const HSN_PRESETS = ['84137010', '84137099'];

async function renderDocumentEditor(root, params) {
  const settings = await window.api.settings.get();
  let customers = await window.api.customers.list();
  let suppliers = await window.api.suppliers.list();
  let products = await window.api.products.list();

  let doc = null;
  let docType = params.docType || 'quotation';
  if (params.docId) {
    doc = await window.api.documents.get(params.docId);
    docType = doc.doc_type;
  }

  const state = {
    docType,
    docId: doc ? doc.id : null,
    docNumber: doc ? doc.doc_number : null,
    docDate: doc ? doc.doc_date : new Date().toISOString().slice(0, 10),
    validUntil: doc ? doc.valid_until : addDays(new Date(), 15),
    customerId: doc ? doc.customer_id : null,
    supplierId: doc ? doc.supplier_id : null,
    placeOfSupply: doc ? doc.place_of_supply : '',
    discount: doc ? doc.discount : 0,
    terms: doc ? doc.terms : settings[termsKeyFor(docType)],
    notes: doc ? doc.notes : settings.default_notes,
    dueDate: doc ? doc.due_date : addDays(new Date(), 30),
    paymentStatus: doc ? (doc.payment_status || 'unpaid') : 'unpaid',
    includeSignature: doc ? (doc.include_signature !== false) : (settings.signature_enabled !== false),
    includeStamp: doc ? (doc.include_stamp !== false) : (settings.stamp_enabled !== false),
    shipToSame: doc ? (doc.ship_to_same !== false) : true,
    shipToName: doc ? doc.ship_to_name || '' : '',
    shipToAddress: doc ? doc.ship_to_address || '' : '',
    shipToCity: doc ? doc.ship_to_city || '' : '',
    shipToState: doc ? doc.ship_to_state || '' : '',
    shipToPincode: doc ? doc.ship_to_pincode || '' : '',
    projectName: doc ? doc.project_name || '' : '',
    enquiryNo: doc ? doc.enquiry_no || '' : '',
    deliverToSame: doc ? (doc.deliver_to_same !== false) : true,
    deliverToName: doc ? doc.deliver_to_name || '' : '',
    deliverToAddress: doc ? doc.deliver_to_address || '' : '',
    deliverToCity: doc ? doc.deliver_to_city || '' : '',
    deliverToState: doc ? doc.deliver_to_state || '' : '',
    deliverToPincode: doc ? doc.deliver_to_pincode || '' : '',
    isRevised: doc ? !!doc.is_revised : false,
    revisionNo: doc ? (doc.revision_no || 0) : 0,
    items: doc ? doc.items.map(it => ({ ...it })) : [emptyItem()]
  };

  root.appendChild(el('h1', { class: 'page-title' }, [doc ? `Edit ${DOC_TYPE_LABELS[docType]}` : `New ${DOC_TYPE_LABELS[docType]}`]));

  // ---- Doc type tabs (only for brand-new documents) ----
  if (!doc) {
    const tabRow = el('div', { class: 'btn-row', style: 'margin-bottom:14px' });
    ['quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'purchase_order', 'techno_commercial'].forEach(t => {
      tabRow.appendChild(el('button', {
        class: `btn ${t === state.docType ? '' : 'secondary'}`,
        onclick: () => {
          state.docType = t;
          state.terms = settings[termsKeyFor(t)];
          root.innerHTML = '';
          renderDocumentEditor(root, { docType: t });
        }
      }, [DOC_TYPE_LABELS[t]]));
    });
    root.appendChild(tabRow);
  }

  const numberPreview = state.docNumber || await window.api.documents.previewNumber(state.docType);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  card.appendChild(el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:16px' }, [
    el('div', {}, [
      el('div', { style: 'font-size:11px;color:#6b7280;font-weight:600' }, ['DOCUMENT NUMBER']),
      el('div', { style: 'font-size:16px;font-weight:700;color:#0e3a5f' }, [numberPreview])
    ]),
    doc ? el('div', { style: 'font-size:11px;color:#6b7280;text-align:right' }, [
      doc.branch_name ? el('div', {}, ['Branch: ' + doc.branch_name]) : null,
      doc.created_at ? el('div', {}, ['Created: ' + fmtDate(doc.created_at)]) : null,
      doc.updated_at && doc.updated_at !== doc.created_at ? el('div', {}, ['Updated: ' + fmtDate(doc.updated_at)]) : null
    ].filter(Boolean)) : null
  ].filter(Boolean)));

  // ---- Customer/Supplier + dates ----
  const isPO = docType === 'purchase_order';
  const customerSelect = el('select', {}, buildCustomerOptions(customers, state.customerId));
  const supplierSelect = el('select', {}, buildSupplierOptions(suppliers, state.supplierId));
  const dateInput = el('input', { type: 'date', value: state.docDate });
  const validUntilInput = el('input', { type: 'date', value: state.validUntil || '' });
  const placeOfSupplySelect = el('select', {}, [
    el('option', { value: '' }, [isPO ? 'Same as supplier state' : 'Same as customer state']),
    ...INDIAN_STATES.map(s => el('option', { value: s, ...(state.placeOfSupply === s ? { selected: 'selected' } : {}) }, [s]))
  ]);

  const metaRow = el('div', { class: 'field-row' }, [
    el('div', { class: 'field' }, [
      el('label', {}, [isPO ? 'Supplier' : 'Customer']),
      isPO ? supplierSelect : customerSelect
    ])
  ]);
  metaRow.appendChild(el('div', { style: 'align-self:flex-end;margin-bottom:12px' }, [
    isPO
      ? el('button', { class: 'btn secondary small', onclick: () => openSupplierModal(null, async () => {
          suppliers = await window.api.suppliers.list();
          supplierSelect.innerHTML = '';
          buildSupplierOptions(suppliers, null).forEach(o => supplierSelect.appendChild(o));
        }) }, ['+ New'])
      : el('button', { class: 'btn secondary small', onclick: () => openCustomerModal(null, async (c) => {
          customers = await window.api.customers.list();
          customerSelect.innerHTML = '';
          buildCustomerOptions(customers, null).forEach(o => customerSelect.appendChild(o));
        }) }, ['+ New'])
  ]));
  card.appendChild(metaRow);

  const dateRow = el('div', { class: 'field-row' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Date']), dateInput])
  ]);
  if (docType !== 'tax_invoice' && docType !== 'delivery_challan' && docType !== 'purchase_order') {
    dateRow.appendChild(el('div', { class: 'field' }, [el('label', {}, ['Valid Until']), validUntilInput]));
  }
  dateRow.appendChild(el('div', { class: 'field' }, [el('label', {}, ['Place of Supply (GST)']), placeOfSupplySelect]));
  card.appendChild(dateRow);

  let projectNameInput, enquiryNoInput;
  if (docType === 'quotation' || docType === 'proforma' || docType === 'purchase_order' || docType === 'techno_commercial') {
    projectNameInput = el('input', { value: state.projectName });
    enquiryNoInput = el('input', { value: state.enquiryNo });
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Project Name']), projectNameInput]),
      el('div', { class: 'field' }, [el('label', {}, [docType === 'purchase_order' ? 'Quotation Ref.' : 'Enquiry No.']), enquiryNoInput])
    ]));
  }

  let revisedInput, revisionLabelSpan;
  if (docType === 'quotation' || docType === 'proforma' || docType === 'techno_commercial') {
    revisedInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
    revisedInput.checked = state.isRevised;
    revisionLabelSpan = el('span', { style: 'font-weight:600;color:#0e3a5f' }, [
      state.isRevised && state.revisionNo ? ` (currently Rev.${state.revisionNo})` : ''
    ]);
    revisedInput.addEventListener('change', () => {
      if (revisedInput.checked) {
        dateInput.value = new Date().toISOString().slice(0, 10);
        state.revisionNo = (state.revisionNo || 0) + 1;
        revisionLabelSpan.textContent = ` (will print as Rev.${state.revisionNo})`;
      } else {
        revisionLabelSpan.textContent = '';
      }
    });
    card.appendChild(el('div', { style: 'margin-top:4px;margin-bottom:14px' }, [
      el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;cursor:pointer' }, [
        revisedInput, 'Revised Offer — updates the date to today and marks this as a revision', revisionLabelSpan
      ])
    ]));
  }

  let dueDateInput, paymentStatusSelect;
  if (docType === 'tax_invoice') {
    dueDateInput = el('input', { type: 'date', value: state.dueDate || '' });
    const isSettled = doc && (doc.payment_status === 'paid' || doc.payment_status === 'partial');
    paymentStatusSelect = el('select', { ...(isSettled ? { disabled: 'disabled' } : {}) }, [
      el('option', { value: 'unpaid', ...(state.paymentStatus === 'unpaid' ? { selected: 'selected' } : {}) }, ['Unpaid']),
      el('option', { value: 'partial', ...(state.paymentStatus === 'partial' ? { selected: 'selected' } : {}) }, ['Partial']),
      el('option', { value: 'paid', ...(state.paymentStatus === 'paid' ? { selected: 'selected' } : {}) }, ['Paid'])
    ]);
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Payment Due Date']), dueDateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Payment Status']), paymentStatusSelect])
    ]));
    if (isSettled) {
      const balance = doc.payment_status === 'partial' ? (doc.total - (doc.payment_amount || 0)) : 0;
      const details = [
        doc.payment_date ? `${doc.payment_status === 'partial' ? 'Last payment' : 'Paid'} on ${fmtDate(doc.payment_date)}` : null,
        doc.payment_amount ? `Amount received: ${fmtMoney(doc.payment_amount)}` : null,
        doc.payment_status === 'partial' ? `Balance due: ${fmtMoney(balance)}` : null,
        doc.payment_reference ? `Reference: ${doc.payment_reference}` : null
      ].filter(Boolean).join('  •  ');
      const bg = doc.payment_status === 'partial' ? '#fef3c7' : '#dcfce7';
      const fg = doc.payment_status === 'partial' ? '#92400e' : '#166534';
      card.appendChild(el('div', { style: `font-size:12px;color:${fg};background:${bg};padding:8px 12px;border-radius:6px;margin:-8px 0 14px 0` }, [
        details || (doc.payment_status === 'partial' ? 'Partially paid.' : 'Marked as paid.'),
        ' — use Mark Paid/Unpaid from the Documents list to change this.'
      ]));
    }
  }

  // ---- Ship To (defaults to Bill To / customer address; editable per document) ----
  const shipToSameInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  shipToSameInput.checked = state.shipToSame;
  const shipToNameInput = el('input', { value: state.shipToName });
  const shipToAddressInput = el('textarea', { rows: 2 }, [state.shipToAddress]);
  const shipToCityInput = el('input', { value: state.shipToCity });
  const shipToStateSelect = el('select', {}, [
    el('option', { value: '' }, ['Select state']),
    ...INDIAN_STATES.map(s => el('option', { value: s, ...(state.shipToState === s ? { selected: 'selected' } : {}) }, [s]))
  ]);
  const shipToPincodeInput = el('input', { value: state.shipToPincode });
  const shipToFields = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, ['Ship To Name / Site']), shipToNameInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Ship To Address']), shipToAddressInput]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['City']), shipToCityInput]),
      el('div', { class: 'field' }, [el('label', {}, ['State']), shipToStateSelect]),
      el('div', { class: 'field' }, [el('label', {}, ['Pincode']), shipToPincodeInput])
    ])
  ]);
  shipToFields.style.display = state.shipToSame ? 'none' : 'block';
  shipToSameInput.addEventListener('change', () => {
    shipToFields.style.display = shipToSameInput.checked ? 'none' : 'block';
  });
  if (!isPO) {
    card.appendChild(el('div', { style: 'margin-top:14px' }, [
      el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;cursor:pointer;margin-bottom:8px' }, [
        shipToSameInput, 'Ship to same address as Bill To'
      ]),
      shipToFields
    ]));
  }

  // ---- Deliver To (purchase orders only — defaults to our own company address) ----
  const deliverToSameInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  deliverToSameInput.checked = state.deliverToSame;
  const deliverToNameInput = el('input', { value: state.deliverToName });
  const deliverToAddressInput = el('textarea', { rows: 2 }, [state.deliverToAddress]);
  const deliverToCityInput = el('input', { value: state.deliverToCity });
  const deliverToStateSelect = el('select', {}, [
    el('option', { value: '' }, ['Select state']),
    ...INDIAN_STATES.map(s => el('option', { value: s, ...(state.deliverToState === s ? { selected: 'selected' } : {}) }, [s]))
  ]);
  const deliverToPincodeInput = el('input', { value: state.deliverToPincode });
  const deliverToFields = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, ['Deliver To Name / Site']), deliverToNameInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Deliver To Address']), deliverToAddressInput]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['City']), deliverToCityInput]),
      el('div', { class: 'field' }, [el('label', {}, ['State']), deliverToStateSelect]),
      el('div', { class: 'field' }, [el('label', {}, ['Pincode']), deliverToPincodeInput])
    ])
  ]);
  deliverToFields.style.display = state.deliverToSame ? 'none' : 'block';
  deliverToSameInput.addEventListener('change', () => {
    deliverToFields.style.display = deliverToSameInput.checked ? 'none' : 'block';
  });
  let priceBasisInput, paymentTermsPoInput, packingTermsInput, freightTermsInput, deliveryScheduleInput, deliveryTypeInput, transportationInput, warrantyInput, scopeOfSupplyInput;
  if (isPO) {
    card.appendChild(el('div', { style: 'margin-top:14px' }, [
      el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;cursor:pointer;margin-bottom:8px' }, [
        deliverToSameInput, 'Deliver to our own company address'
      ]),
      deliverToFields
    ]));

    priceBasisInput = el('input', { value: doc ? doc.price_basis || '' : '', placeholder: 'e.g. Ex-Works' });
    paymentTermsPoInput = el('input', { value: doc ? doc.payment_terms || '' : '', placeholder: 'e.g. 10% Rolling Advance, 90% Against LR Document' });
    packingTermsInput = el('input', { value: doc ? doc.packing_terms || '' : '', placeholder: 'e.g. Included' });
    freightTermsInput = el('input', { value: doc ? doc.freight_terms || '' : '', placeholder: 'e.g. To-pay' });
    deliveryScheduleInput = el('input', { value: doc ? doc.delivery_schedule || '' : '', placeholder: 'e.g. 14-16 Working Weeks' });
    deliveryTypeInput = el('input', { value: doc ? doc.delivery_type || '' : '', placeholder: 'e.g. Godown Delivery' });
    transportationInput = el('input', { value: doc ? doc.transportation || '' : '', placeholder: 'e.g. By Road' });
    warrantyInput = el('input', { value: doc ? doc.warranty_terms || '' : '', placeholder: 'e.g. 12 months from commissioning or 18 months from dispatch' });
    scopeOfSupplyInput = el('textarea', { rows: 2, placeholder: 'e.g. KOEL Engine + Pump + Coupling + Coupling Guard + Baseframe' }, [doc ? doc.scope_of_supply || '' : '']);

    card.appendChild(el('div', { style: 'margin-top:14px' }, [
      el('h3', { style: 'font-size:13px;color:#0e3a5f;margin:0 0 10px' }, ['Commercial Terms']),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, ['Price Basis']), priceBasisInput]),
        el('div', { class: 'field' }, [el('label', {}, ['Terms of Payment']), paymentTermsPoInput])
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, ['Packing']), packingTermsInput]),
        el('div', { class: 'field' }, [el('label', {}, ['Freight']), freightTermsInput])
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, ['Delivery Schedule']), deliveryScheduleInput]),
        el('div', { class: 'field' }, [el('label', {}, ['Delivery Type']), deliveryTypeInput]),
        el('div', { class: 'field' }, [el('label', {}, ['Transportation']), transportationInput])
      ]),
      el('div', { class: 'field' }, [el('label', {}, ['Scope of Supply']), scopeOfSupplyInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Warranty']), warrantyInput])
    ]));
  }

  let vehicleInput, transporterInput, driverNameInput, driverContactInput, placeOfDeliveryInput, transportReasonInput;
  if (docType === 'delivery_challan') {
    vehicleInput = el('input', { value: doc ? doc.vehicle_no || '' : '' });
    transporterInput = el('input', { value: doc ? doc.transporter_name || '' : '' });
    driverNameInput = el('input', { value: doc ? doc.driver_name || '' : '' });
    driverContactInput = el('input', { value: doc ? doc.driver_contact || '' : '' });
    placeOfDeliveryInput = el('input', { value: doc ? doc.place_of_delivery || '' : '' });
    transportReasonInput = el('input', { value: doc ? doc.transport_reason || '' : '', placeholder: 'e.g. Stock transfer, Job work, On approval' });
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Vehicle No.']), vehicleInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Transporter Name']), transporterInput])
    ]));
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Driver Name']), driverNameInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Driver Contact']), driverContactInput])
    ]));
    card.appendChild(el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Place of Delivery']), placeOfDeliveryInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Reason for Transport']), transportReasonInput])
    ]));
  }

  // ---- Items table ----
  const itemsTable = el('table', { class: 'items-editor-table' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { class: 'col-desc' }, ['Description']), el('th', { class: 'col-hsn' }, ['HSN/SAC']),
      el('th', { class: 'col-qty' }, ['Qty']), el('th', { class: 'col-rate' }, ['Rate']),
      el('th', { class: 'col-gst' }, ['GST %']), el('th', { class: 'col-amt' }, ['Amount']), el('th', { class: 'col-del' }, [''])
    ])])
  ]);
  const itemsBody = el('tbody');
  itemsTable.appendChild(itemsBody);
  card.appendChild(itemsTable);
  card.appendChild(el('button', {
    class: 'btn secondary small', onclick: () => { state.items.push(emptyItem()); renderItems(); }
  }, ['+ Add Item']));

  // Moves accessories / engine accessories out of an item into their own rows, each with its own
  // rate (discounted price + freight % + margin %). Row rates add up to the same total as before.
  function splitAccessoriesLines(idx) {
    const parent = state.items[idx];
    const title = (parent.description || '').split('\n')[0].trim();
    const parts = [
      { on: parent.use_accessories, name: 'Accessories', spec: parent.spec_accessories, lp: parent.item_acc_lp, d: parent.item_acc_discount_pct },
      { on: parent.use_engine_accessories, name: 'Engine Accessories', spec: parent.spec_engine_accessories, lp: parent.item_eng_acc_lp, d: parent.item_eng_acc_discount_pct }
    ].filter(p => p.on);
    const added = parts.map(p => {
      const row = emptyItem();
      row.description = [`${p.name}${title ? ' for ' + title : ''}`, ...String(p.spec || '').split('\n').map(s => s.trim()).filter(Boolean)].join('\n');
      row.hsn_sac = parent.hsn_sac; row.qty = parent.qty; row.gst_percent = parent.gst_percent;
      row.use_pricing_calc = true;
      row.item_lp = p.lp; row.item_discount_pct = p.d;
      row.item_freight = parent.item_freight; row.item_margin_pct = parent.item_margin_pct;
      if (p.name === 'Accessories') { row.item_fixed_price = parent.item_fixed_price; }
      row.rate = computeItemPricing(row).rate;
      return row;
    });
    parent.use_accessories = false; parent.use_engine_accessories = false; parent.use_acc_pricing_calc = false;
    if (parts.some(p => p.name === 'Accessories')) parent.item_fixed_price = null;
    if (parent.use_pricing_calc) parent.rate = computeItemPricing(parent).rate;
    state.items.splice(idx + 1, 0, ...added);
    renderItems();
  }

  function renderItems() {
    itemsBody.innerHTML = '';
    state.items.forEach((item, idx) => {
      const productSelect = el('select', {}, [
        el('option', { value: '' }, ['Custom item...']),
        ...products.map(p => el('option', {
          value: p.id, ...(item.product_id == p.id ? { selected: 'selected' } : {})
        }, [String(p.description || '').split('\n')[0] + (p.spec_model ? ' — ' + p.spec_model : '')]))
      ]);
      productSelect.addEventListener('change', () => {
        const p = products.find(pp => String(pp.id) === productSelect.value);
        if (p) {
          item.product_id = p.id;
          item.description = p.description;
          // Specs saved with the product go straight into their own fields and switch those toggles on.
          item.use_structured_specs = !!p.use_structured_specs;
          item.spec_flow_head = p.spec_flow_head || ''; item.spec_model = p.spec_model || '';
          item.spec_kw_rpm = p.spec_kw_rpm || ''; item.spec_moc = p.spec_moc || '';
          item.use_engine_spec = !!p.use_engine_spec; item.spec_engine = p.spec_engine || '';
          item.use_engine_accessories = !!p.use_engine_accessories; item.spec_engine_accessories = p.spec_engine_accessories || '';
          item.use_accessories = !!p.use_accessories; item.spec_accessories = p.spec_accessories || '';
          item.hsn_sac = p.hsn_sac;
          item.rate = p.default_rate;
          item.gst_percent = p.gst_percent;
        } else {
          item.product_id = null;
        }
        renderItems();
      });

      const useSpecs = !!item.use_structured_specs;
      const descInput = useSpecs
        ? el('input', { value: (item.description || '').split('\n')[0] || '', placeholder: 'Item title' })
        : el('textarea', {
            rows: 3,
            placeholder: 'First line = item title (bold on the PDF). Add more lines below for specs — Flow & Head, Model, KW & RPM, MOC, etc.'
          }, [item.description || '']);
      descInput.addEventListener('input', () => { item.description = descInput.value; });

      const specsToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      specsToggle.checked = useSpecs;
      specsToggle.addEventListener('change', () => {
        item.use_structured_specs = specsToggle.checked;
        if (specsToggle.checked) {
          // Switching on: keep only the title line, drop any free-typed detail lines.
          item.description = (item.description || '').split('\n')[0] || '';
        }
        renderItems();
      });
      const specsToggleLabel = el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [specsToggle, 'Use fixed pump spec fields']);

      const useEngineSpec = !!item.use_engine_spec;
      const engineSpecToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      engineSpecToggle.checked = useEngineSpec;
      engineSpecToggle.addEventListener('change', () => { item.use_engine_spec = engineSpecToggle.checked; renderItems(); });
      const engineSpecToggleLabel = el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [engineSpecToggle, 'Use engine spec field (diesel-driven pumps)']);

      const useEngineAccessories = !!item.use_engine_accessories;
      const engineAccessoriesToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      engineAccessoriesToggle.checked = useEngineAccessories;
      engineAccessoriesToggle.addEventListener('change', () => { item.use_engine_accessories = engineAccessoriesToggle.checked; if (item.use_pricing_calc || item.use_acc_pricing_calc) item.rate = computeItemPricing(item).rate; renderItems(); });
      const engineAccessoriesToggleLabel = el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [engineAccessoriesToggle, 'Use engine accessories field']);

      const useAccessories = !!item.use_accessories;
      const accessoriesToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      accessoriesToggle.checked = useAccessories;
      accessoriesToggle.addEventListener('change', () => { item.use_accessories = accessoriesToggle.checked; if (item.use_pricing_calc || item.use_acc_pricing_calc) item.rate = computeItemPricing(item).rate; renderItems(); });
      const accessoriesToggleLabel = el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [accessoriesToggle, 'Use accessories field (booster pumps)']);

      const pricingAllowed = ['quotation', 'proforma', 'tax_invoice', 'techno_commercial'].includes(docType);
      const usePricing = pricingAllowed && !!item.use_pricing_calc;
      const pricingToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      pricingToggle.checked = usePricing;
      pricingToggle.addEventListener('change', () => { item.use_pricing_calc = pricingToggle.checked; renderItems(); });
      const pricingToggleLabel = pricingAllowed ? el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [pricingToggle, 'Calculate pump rate from list price (internal)']) : null;

      const useAccPricing = pricingAllowed && !!item.use_acc_pricing_calc && (useAccessories || useEngineAccessories);
      const accPricingToggle = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      accPricingToggle.checked = useAccPricing;
      accPricingToggle.addEventListener('change', () => { item.use_acc_pricing_calc = accPricingToggle.checked; renderItems(); });
      const accPricingToggleLabel = (pricingAllowed && (useAccessories || useEngineAccessories)) ? el('label', {
        style: 'display:flex;align-items:center;gap:5px;font-size:10.5px;color:#6b7280;cursor:pointer;margin-top:4px'
      }, [accPricingToggle, 'Calculate accessories price from list price (internal)']) : null;

      const hsnIsCustom = !!item.hsn_sac && !HSN_PRESETS.includes(item.hsn_sac);
      const hsnSelect = el('select', {}, [
        el('option', { value: '' }, ['Select HSN...']),
        ...HSN_PRESETS.map(code => el('option', {
          value: code, ...(item.hsn_sac === code ? { selected: 'selected' } : {})
        }, [code])),
        el('option', { value: '__custom__', ...(hsnIsCustom ? { selected: 'selected' } : {}) }, ['Custom...'])
      ]);
      const hsnCustomInput = el('input', { value: hsnIsCustom ? item.hsn_sac : '', placeholder: 'HSN/SAC code' });
      hsnCustomInput.style.display = hsnIsCustom ? 'block' : 'none';
      hsnSelect.addEventListener('change', () => {
        if (hsnSelect.value === '__custom__') {
          hsnCustomInput.style.display = 'block';
          hsnCustomInput.focus();
          item.hsn_sac = hsnCustomInput.value;
        } else {
          hsnCustomInput.style.display = 'none';
          item.hsn_sac = hsnSelect.value;
        }
      });
      hsnCustomInput.addEventListener('input', () => { item.hsn_sac = hsnCustomInput.value; });

      const qtyInput = el('input', { type: 'number', step: '1', value: item.qty || 1 });
      qtyInput.addEventListener('input', () => { item.qty = parseFloat(qtyInput.value) || 0; updateTotals(); });

      const rateInput = el('input', { type: 'number', step: '0.01', value: item.rate || 0 });
      rateInput.addEventListener('input', () => { item.rate = parseFloat(rateInput.value) || 0; updateTotals(); });

      const gstInput = el('input', { type: 'number', step: '0.01', value: item.gst_percent ?? settings.default_gst_percent });
      gstInput.addEventListener('input', () => { item.gst_percent = parseFloat(gstInput.value) || 0; updateTotals(); });

      const amount = (item.qty || 0) * (item.rate || 0);

      // Tax Invoice / Delivery Challan: pick the serial-numbered units from stock (qty follows the count).
      let serialBlock = null;
      if (docType === 'tax_invoice' || docType === 'delivery_challan') {
        const serials = item.serial_nos || [];
        serialBlock = el('div', { style: 'margin-top:6px;font-size:11.5px' }, [
          serials.length
            ? el('div', { style: 'color:#0e3a5f;font-weight:600;margin-bottom:3px' }, ['Serial Nos: ' + serials.join(', ')])
            : null,
          el('span', { class: 'btn small secondary', onclick: () => openSerialPicker(
            { item, docId: state.docId, docType },
            (picked) => {
              item.serial_nos = picked.length ? picked : null;
              if (picked.length) item.qty = picked.length;
              renderItems();
              updateTotals();
            }
          ) }, [serials.length ? 'Change Serial Nos' : '🏷️ Select Serial Nos from Stock'])
        ].filter(Boolean));
      }

      itemsBody.appendChild(el('tr', {}, [
        el('td', {}, [productSelect, descInput, specsToggleLabel, engineSpecToggleLabel, engineAccessoriesToggleLabel, accessoriesToggleLabel, pricingToggleLabel, accPricingToggleLabel, serialBlock].filter(Boolean)),
        el('td', {}, [hsnSelect, hsnCustomInput]),
        el('td', {}, [qtyInput]),
        el('td', {}, [rateInput]),
        el('td', {}, [gstInput]),
        el('td', { class: 'col-amt' }, [fmtMoney(amount)]),
        el('td', { class: 'col-del' }, [
          el('span', {
            style: 'cursor:pointer;color:#c0392b;font-weight:700',
            onclick: () => { state.items.splice(idx, 1); if (state.items.length === 0) state.items.push(emptyItem()); renderItems(); }
          }, ['✕'])
        ])
      ]));

      const specFields = [];
      if (useSpecs) {
        const flowHeadInput = el('input', { value: item.spec_flow_head || '', placeholder: 'e.g. 137 CMH @ 70 M head' });
        flowHeadInput.addEventListener('input', () => { item.spec_flow_head = flowHeadInput.value; });
        const modelInput = el('input', { value: item.spec_model || '', placeholder: 'e.g. KOEL model no.' });
        modelInput.addEventListener('input', () => { item.spec_model = modelInput.value; });
        const kwRpmInput = el('input', { value: item.spec_kw_rpm || '', placeholder: 'e.g. 45 KW @ 2974 RPM' });
        kwRpmInput.addEventListener('input', () => { item.spec_kw_rpm = kwRpmInput.value; });
        const mocInput = el('input', { value: item.spec_moc || '', placeholder: 'e.g. Cast iron casing, bronze impeller' });
        mocInput.addEventListener('input', () => { item.spec_moc = mocInput.value; });
        specFields.push(
          el('div', { class: 'field' }, [el('label', {}, ['Flow & Head']), flowHeadInput]),
          el('div', { class: 'field' }, [el('label', {}, ['Model']), modelInput]),
          el('div', { class: 'field' }, [el('label', {}, ['KW & RPM']), kwRpmInput]),
          el('div', { class: 'field' }, [el('label', {}, ['MOC']), mocInput])
        );
      }
      if (useEngineSpec) {
        const engineInput = el('input', { value: item.spec_engine || '', placeholder: 'e.g. 61HP/2900 RPM/KOEL RC/4R810/12V' });
        engineInput.addEventListener('input', () => { item.spec_engine = engineInput.value; });
        specFields.push(el('div', { class: 'field' }, [el('label', {}, ['Engine Spec']), engineInput]));
      }
      if (useEngineAccessories) {
        const engineAccInput = el('input', { value: item.spec_engine_accessories || '', placeholder: 'e.g. 12V Battery, 300L Fuel Tank, Battery Charger, Residential silencer and cable' });
        engineAccInput.addEventListener('input', () => { item.spec_engine_accessories = engineAccInput.value; });
        specFields.push(el('div', { class: 'field' }, [el('label', {}, ['Engine Accessories']), engineAccInput]));
      }
      if (useAccessories) {
        const accessoriesInput = el('input', { value: item.spec_accessories || '', placeholder: 'e.g. Pressure tank, pressure switch, non-return valve, control panel' });
        accessoriesInput.addEventListener('input', () => { item.spec_accessories = accessoriesInput.value; });
        specFields.push(el('div', { class: 'field' }, [el('label', {}, ['Accessories']), accessoriesInput]));
      }
      if (usePricing || useAccPricing) {
        // Internal only: none of these four values are printed on the document, only the resulting Rate.
        const calcNote = el('div', { style: 'flex-basis:100%;font-size:11px;color:#0e3a5f;font-weight:600' });
        const describeCalc = (c) => {
          const parts = [];
          if (usePricing) parts.push(`Pump ${fmtMoney(c.pump)}`);
          if (useAccPricing && item.use_accessories) parts.push(`Accessories ${fmtMoney(c.acc)}`);
          if (useAccPricing && item.use_engine_accessories) parts.push(`Engine accessories ${fmtMoney(c.engAcc)}`);
          parts.push(`Freight ${fmtMoney(c.freight)}`, `Margin ${fmtMoney(c.margin)}`);
          if (c.fixed) parts.push(`Ready price ${fmtMoney(c.fixed)}`);
          return `${parts.join(' + ')} = Rate ${fmtMoney(c.rate)}`;
        };
        const refreshCalc = () => {
          const c = computeItemPricing(item);
          calcNote.textContent = describeCalc(c);
          item.rate = c.rate;
          rateInput.value = c.rate;
          updateTotals();
        };
        const pricingField = (label, key, placeholder) => {
          const input = el('input', { type: 'number', step: '0.01', value: item[key] ?? '', placeholder });
          input.addEventListener('input', () => { item[key] = input.value === '' ? null : parseFloat(input.value); refreshCalc(); });
          return el('div', { class: 'field' }, [el('label', {}, [label]), input]);
        };
        if (usePricing) {
          specFields.push(
            pricingField('List Price (LP)', 'item_lp', 'e.g. 100000'),
            pricingField('Discount %', 'item_discount_pct', 'e.g. 30')
          );
        }
        if (useAccPricing && item.use_accessories) {
          specFields.push(
            pricingField('Accessories LP', 'item_acc_lp', 'e.g. 10000'),
            pricingField('Accessories Discount %', 'item_acc_discount_pct', 'e.g. 20')
          );
        }
        if (useAccPricing && item.use_engine_accessories) {
          specFields.push(
            pricingField('Engine Accessories LP', 'item_eng_acc_lp', 'e.g. 25000'),
            pricingField('Engine Accessories Discount %', 'item_eng_acc_discount_pct', 'e.g. 20')
          );
        }
        specFields.push(
          pricingField('Freight %', 'item_freight', 'e.g. 3'),
          pricingField('Margin %', 'item_margin_pct', 'e.g. 15'),
          pricingField('Ready sale price (added as is)', 'item_fixed_price', 'e.g. 52000 pressure tank'),
          calcNote
        );
        if (useAccPricing) {
          specFields.push(el('button', {
            class: 'btn secondary small', style: 'flex-basis:100%',
            title: 'Moves the accessories into their own line(s) with their own rate; the total stays the same.',
            onclick: () => splitAccessoriesLines(idx)
          }, ['Split accessories into separate line(s)']));
        }
        // Show the breakdown for values already saved, without overwriting a hand-edited rate on open.
        calcNote.textContent = (item.item_lp || item.item_acc_lp || item.item_eng_acc_lp)
          ? `${describeCalc(computeItemPricing(item))} — edit any field to recalculate the Rate`
          : 'Enter List Price to calculate the Rate';
      }

      if (specFields.length > 0) {
        itemsBody.appendChild(el('tr', { class: 'item-specs-row' }, [
          el('td', { colspan: '7' }, [
            el('div', { class: 'item-specs-grid' }, specFields)
          ])
        ]));
      }
    });
    updateTotals();
  }

  // ---- Discount + totals ----
  const discountInput = el('input', { type: 'number', step: '0.01', value: state.discount || 0 });
  discountInput.addEventListener('input', updateTotals);

  const totalsPanel = el('div', { class: 'totals-panel' });
  card.appendChild(el('div', { class: 'field', style: 'max-width:220px;margin-top:10px' }, [
    el('label', {}, ['Discount (₹)']), discountInput
  ]));
  card.appendChild(totalsPanel);

  function updateTotals() {
    const items = state.items.filter(it => it.description && it.description.trim());
    let subtotal = 0, taxTotal = 0;
    items.forEach(it => {
      const amt = round2((it.qty || 0) * (it.rate || 0));
      subtotal += amt;
      taxTotal += amt * ((it.gst_percent || 0) / 100);
    });
    subtotal = round2(subtotal);
    const discount = parseFloat(discountInput.value) || 0;
    const taxableAfterDiscount = Math.max(0, subtotal - discount);
    const effectiveTax = subtotal > 0 ? taxTotal * (taxableAfterDiscount / subtotal) : 0;

    const party = isPO
      ? suppliers.find(s => String(s.id) === supplierSelect.value)
      : customers.find(c => String(c.id) === customerSelect.value);
    const partyState = placeOfSupplySelect.value || (party ? party.state : '');
    const sameState = (settings.state || '').trim().toLowerCase() === (partyState || '').trim().toLowerCase();
    let cgst = 0, sgst = 0, igst = 0;
    if (sameState) { cgst = round2(effectiveTax / 2); sgst = round2(effectiveTax / 2); }
    else igst = round2(effectiveTax);

    const preRound = taxableAfterDiscount + cgst + sgst + igst;
    const roundOff = round2(Math.round(preRound) - preRound);
    const total = round2(preRound + roundOff);

    totalsPanel.innerHTML = '';
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Subtotal']), el('span', {}, [fmtMoney(subtotal)])]));
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Discount']), el('span', {}, [fmtMoney(discount)])]));
    if (sameState) {
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['CGST']), el('span', {}, [fmtMoney(cgst)])]));
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['SGST']), el('span', {}, [fmtMoney(sgst)])]));
    } else {
      totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['IGST']), el('span', {}, [fmtMoney(igst)])]));
    }
    totalsPanel.appendChild(el('div', { class: 'row' }, [el('span', {}, ['Round off']), el('span', {}, [fmtMoney(roundOff)])]));
    totalsPanel.appendChild(el('div', { class: 'row total' }, [el('span', {}, ['Total']), el('span', {}, [fmtMoney(total)])]));
  }

  customerSelect.addEventListener('change', updateTotals);
  supplierSelect.addEventListener('change', updateTotals);
  placeOfSupplySelect.addEventListener('change', updateTotals);
  renderItems();

  // ---- Terms & Notes ----
  const termsInput = el('textarea', { rows: 4 }, [state.terms || '']);
  const notesInput = el('textarea', { rows: 2 }, [state.notes || '']);
  card.appendChild(el('div', { class: 'field-row', style: 'margin-top:14px' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Terms & Conditions']), termsInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Notes']), notesInput])
  ]));

  const includeSignatureInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  includeSignatureInput.checked = state.includeSignature;
  const includeStampInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
  includeStampInput.checked = state.includeStamp;

  const toggleRow = el('div', { style: 'display:flex;gap:20px;margin-top:14px' });
  if (settings.signature_data_uri && settings.signature_enabled !== false) {
    toggleRow.appendChild(el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;cursor:pointer' }, [
      includeSignatureInput, 'Include signature'
    ]));
  }
  if (settings.stamp_data_uri && settings.stamp_enabled !== false) {
    toggleRow.appendChild(el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;cursor:pointer' }, [
      includeStampInput, 'Include stamp'
    ]));
  }
  if (toggleRow.children.length > 0) card.appendChild(toggleRow);

  // ---- Actions ----
  const actionRow = el('div', { class: 'btn-row', style: 'margin-top:16px' });
  actionRow.appendChild(el('button', { class: 'btn secondary', onclick: () => navigate('documents') }, ['Cancel']));
  actionRow.appendChild(el('button', {
    class: 'btn', onclick: async () => {
      const items = state.items.filter(it => it.description && it.description.trim());
      if (items.length === 0) { showToast('Add at least one item'); return; }
      if (isPO ? !supplierSelect.value : !customerSelect.value) {
        showToast(isPO ? 'Please select a supplier' : 'Please select a customer');
        return;
      }
      const payload = {
        doc_type: state.docType,
        doc_date: dateInput.value,
        valid_until: (docType !== 'tax_invoice' && docType !== 'delivery_challan' && docType !== 'purchase_order') ? (validUntilInput.value || null) : null,
        customer_id: isPO ? null : parseInt(customerSelect.value, 10),
        supplier_id: isPO ? parseInt(supplierSelect.value, 10) : null,
        place_of_supply: placeOfSupplySelect.value || null,
        discount: parseFloat(discountInput.value) || 0,
        terms: termsInput.value,
        notes: notesInput.value,
        due_date: docType === 'tax_invoice' ? (dueDateInput.value || null) : null,
        payment_status: docType === 'tax_invoice' ? paymentStatusSelect.value : null,
        vehicle_no: docType === 'delivery_challan' ? (vehicleInput.value.trim() || null) : null,
        transporter_name: docType === 'delivery_challan' ? (transporterInput.value.trim() || null) : null,
        driver_name: docType === 'delivery_challan' ? (driverNameInput.value.trim() || null) : null,
        driver_contact: docType === 'delivery_challan' ? (driverContactInput.value.trim() || null) : null,
        place_of_delivery: docType === 'delivery_challan' ? (placeOfDeliveryInput.value.trim() || null) : null,
        transport_reason: docType === 'delivery_challan' ? (transportReasonInput.value.trim() || null) : null,
        include_signature: includeSignatureInput.checked,
        include_stamp: includeStampInput.checked,
        ship_to_same: shipToSameInput.checked,
        ship_to_name: shipToNameInput.value.trim() || null,
        ship_to_address: shipToAddressInput.value.trim() || null,
        ship_to_city: shipToCityInput.value.trim() || null,
        ship_to_state: shipToStateSelect.value || null,
        ship_to_pincode: shipToPincodeInput.value.trim() || null,
        project_name: projectNameInput ? (projectNameInput.value.trim() || null) : null,
        enquiry_no: enquiryNoInput ? (enquiryNoInput.value.trim() || null) : null,
        deliver_to_same: deliverToSameInput.checked,
        deliver_to_name: deliverToNameInput.value.trim() || null,
        deliver_to_address: deliverToAddressInput.value.trim() || null,
        deliver_to_city: deliverToCityInput.value.trim() || null,
        deliver_to_state: deliverToStateSelect.value || null,
        deliver_to_pincode: deliverToPincodeInput.value.trim() || null,
        is_revised: revisedInput ? revisedInput.checked : false,
        revision_no: revisedInput ? state.revisionNo : 0,
        price_basis: priceBasisInput ? (priceBasisInput.value.trim() || null) : null,
        payment_terms: paymentTermsPoInput ? (paymentTermsPoInput.value.trim() || null) : null,
        packing_terms: packingTermsInput ? (packingTermsInput.value.trim() || null) : null,
        freight_terms: freightTermsInput ? (freightTermsInput.value.trim() || null) : null,
        warranty_terms: warrantyInput ? (warrantyInput.value.trim() || null) : null,
        scope_of_supply: scopeOfSupplyInput ? (scopeOfSupplyInput.value.trim() || null) : null,
        delivery_schedule: deliveryScheduleInput ? (deliveryScheduleInput.value.trim() || null) : null,
        delivery_type: deliveryTypeInput ? (deliveryTypeInput.value.trim() || null) : null,
        transportation: transportationInput ? (transportationInput.value.trim() || null) : null,
        items
      };
      const serialMismatch = items.find(it => it.serial_nos && it.serial_nos.length && it.serial_nos.length !== it.qty);
      if (serialMismatch) {
        showToast(`"${String(serialMismatch.description).split('\n')[0]}": qty is ${serialMismatch.qty} but ${serialMismatch.serial_nos.length} serial no(s) selected`);
        return;
      }
      let saved;
      try {
        if (state.docId) saved = await window.api.documents.update(state.docId, payload);
        else saved = await window.api.documents.create(payload);
      } catch (err) {
        showToast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        return;
      }
      showToast(`Saved ${saved.doc_number}`);
      navigate('document-editor', { docId: saved.id, preview: true });
    }
  }, [doc ? 'Save Changes' : 'Save Document']));

  if (doc) {
    actionRow.appendChild(el('button', { class: 'btn secondary', onclick: () => openPreview(doc.id) }, ['Preview / Print']));
  }
  card.appendChild(actionRow);

  if (params.preview && doc) {
    openPreview(doc.id);
  }
}

// Guards against the "Preview / Print" button being double-clicked (or the
// auto-preview-after-save and a manual click racing each other) before the
// first call's awaits (document fetch, settings fetch, CSS fetch) resolve —
// without this, two overlays could stack, and a Close on the top one would
// silently reveal a second live preview underneath.
let previewModalOpen = false;
async function openPreview(docId) {
  if (previewModalOpen) return;
  previewModalOpen = true;
  let doc, settings, customer, cssText;
  try {
    doc = await window.api.documents.get(docId);
    settings = await window.api.settings.get();
    customer = doc.customer_snapshot || null;
    cssText = await fetch('css/document-theme.css').then(r => r.text());
  } catch (err) {
    previewModalOpen = false;
    throw err;
  }
  const html = buildDocumentHtml(doc, settings, customer, cssText);

  const overlay = el('div', { class: 'modal-overlay', style: 'align-items:flex-start;padding:30px 0' });
  const nextStage = { quotation: 'proforma', proforma: 'tax_invoice' }[doc.doc_type];
  const nextStageLabel = { proforma: 'Proforma', tax_invoice: 'Tax Invoice' };
  const toolbar = el('div', { class: 'preview-toolbar' }, [
    el('button', { class: 'btn secondary', onclick: () => { overlay.remove(); previewModalOpen = false; } }, ['Close']),
    el('button', { class: 'btn secondary', onclick: async () => { const r = await window.api.document.print(html); if (r.success) showToast('Sent to printer'); } }, ['Print']),
    el('button', { class: 'btn', onclick: async () => {
      const r = await window.api.document.savePdf(html, pdfFilenameFor(doc), doc.doc_type);
      if (r.success) showToast('PDF saved: ' + r.filePath);
    } }, ['Save as PDF']),
    el('button', { class: 'btn secondary', onclick: async () => {
      const r = await window.api.document.savePdf(html, pdfFilenameFor(doc), doc.doc_type);
      if (!r.success) return;
      const label = DOC_TYPE_LABELS[doc.doc_type] || 'Document';
      window.api.document.openMailto({
        to: (customer && customer.email) || '',
        subject: `${label} ${doc.doc_number} from ${settings.name}`,
        body: `Hi,\n\nPlease find attached ${label} ${doc.doc_number}.\n\nThank you,\n${settings.name}`
      });
      window.api.document.revealInFolder(r.filePath);
      showToast('PDF saved — attach it in the email that just opened');
    } }, ['✉ Send Email']),
    (customer && customer.mobile) ? el('button', { class: 'btn secondary', onclick: () => {
      const digits = customer.mobile.replace(/\D/g, '');
      const withCountry = digits.length === 10 ? '91' + digits : digits;
      window.api.document.openExternal(`https://wa.me/${withCountry}`);
    } }, ['💬 WhatsApp']) : null,
    nextStage ? el('button', { class: 'btn', onclick: async () => {
      const created = await window.api.documents.duplicateAs(doc.id, nextStage);
      overlay.remove();
      showToast(`Created ${created.doc_number}`);
      navigate('document-editor', { docId: created.id });
    } }, [`→ Convert to ${nextStageLabel[nextStage]}`]) : null
  ].filter(Boolean));
  const iframe = el('iframe');
  const wrap = el('div', { class: 'preview-frame-wrap' }, [iframe]);
  const box = el('div', { style: 'width:100%;max-width:900px' }, [toolbar, wrap]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  // Documents can run longer than one A4 page (HSN table, amount-in-words,
  // declaration, etc.) — size the iframe to its actual content height so the
  // whole thing is visible via the outer wrap's scrollbar, not clipped or
  // hidden behind a separate inner scrollbar.
  iframe.addEventListener('load', () => {
    const doc2 = iframe.contentDocument;
    if (doc2 && doc2.body) {
      iframe.style.height = doc2.documentElement.scrollHeight + 'px';
    }
  });
  iframe.srcdoc = html;
}

function buildCustomerOptions(customers, selectedId) {
  return [
    el('option', { value: '' }, ['Select a customer']),
    ...customers.map(c => el('option', {
      value: c.id, ...(selectedId && String(selectedId) === String(c.id) ? { selected: 'selected' } : {})
    }, [c.name]))
  ];
}

function buildSupplierOptions(suppliers, selectedId) {
  return [
    el('option', { value: '' }, ['Select a supplier']),
    ...suppliers.map(s => el('option', {
      value: s.id, ...(selectedId && String(selectedId) === String(s.id) ? { selected: 'selected' } : {})
    }, [s.name]))
  ];
}

function emptyItem() {
  return {
    product_id: null, description: '', hsn_sac: '', qty: 1, rate: 0, gst_percent: 18,
    use_structured_specs: false, spec_flow_head: '', spec_model: '', spec_kw_rpm: '', spec_moc: '',
    use_engine_spec: false, spec_engine: '',
    use_engine_accessories: false, spec_engine_accessories: '',
    use_accessories: false, spec_accessories: '',
    use_pricing_calc: false, use_acc_pricing_calc: false, item_lp: null, item_discount_pct: null, item_freight: null, item_margin_pct: null,
    item_acc_lp: null, item_acc_discount_pct: null, item_eng_acc_lp: null, item_eng_acc_discount_pct: null,
    item_fixed_price: null,
    serial_nos: null
  };
}

// Internal rate calculator: discounted pump + discounted accessories (if enabled) -> freight % -> margin %.
function computeItemPricing(item) {
  const num = (v) => parseFloat(v) || 0;
  const disc = (lp, d) => round2(num(lp) * (1 - num(d) / 100));
  const pump = item.use_pricing_calc ? disc(item.item_lp, item.item_discount_pct) : 0;
  const acc = item.use_acc_pricing_calc && item.use_accessories ? disc(item.item_acc_lp, item.item_acc_discount_pct) : 0;
  const engAcc = item.use_acc_pricing_calc && item.use_engine_accessories ? disc(item.item_eng_acc_lp, item.item_eng_acc_discount_pct) : 0;
  const base = round2(pump + acc + engAcc);
  const freight = round2(base * num(item.item_freight) / 100);
  const margin = round2((base + freight) * num(item.item_margin_pct) / 100);
  const fixed = round2(num(item.item_fixed_price));
  const rate = round2(base + freight + margin + fixed);
  return { pump, acc, engAcc, base, freight, margin, fixed, rate };
}

function termsKeyFor(docType) {
  if (docType === 'quotation') return 'quotation_terms';
  if (docType === 'proforma') return 'proforma_terms';
  if (docType === 'purchase_order') return 'purchase_order_terms';
  if (docType === 'techno_commercial') return 'techno_commercial_terms';
  return 'tax_invoice_terms';
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
