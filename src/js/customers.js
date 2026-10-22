async function renderCustomers(root, params) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Customers']));

  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search by name or GSTIN...' });
  searchRow.appendChild(searchInput);
  searchRow.appendChild(el('button', {
    class: 'btn secondary',
    onclick: async () => {
      const r = await window.api.exportExcel.customers();
      if (r.success) showToast('Exported: ' + r.filePath);
    }
  }, ['⬇ Export to Excel']));
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => openCustomerModal(null, load) }, ['+ Add Customer']));
  root.appendChild(searchRow);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  async function load() {
    card.innerHTML = '';
    const list = await window.api.customers.list(searchInput.value.trim());
    if (list.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['No customers found.']));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Name']), el('th', {}, ['City / State']), el('th', {}, ['Mobile']),
        el('th', {}, ['GSTIN']), el('th', {}, [''])
      ])])
    ]);
    const tbody = el('tbody');
    list.forEach(c => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [c.name]),
        el('td', {}, [[c.city, c.state].filter(Boolean).join(', ')]),
        el('td', {}, [c.mobile || '-']),
        el('td', {}, [c.gstin || '-']),
        el('td', {}, [
          el('div', { class: 'btn-row' }, [
            el('span', { class: 'btn small secondary', onclick: () => openCustomerModal(c, load) }, ['Edit']),
            el('span', { class: 'btn small danger', onclick: async () => {
              if (confirmDialog(`Delete customer "${c.name}"?`)) {
                await window.api.customers.delete(c.id);
                showToast('Customer deleted');
                load();
              }
            } }, ['Delete'])
          ])
        ])
      ]));
    });
    table.appendChild(tbody);
    card.appendChild(table);
  }

  searchInput.addEventListener('input', debounce(load, 250));
  load();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function openCustomerModal(customer, onSaved) {
  const isEdit = !!customer;
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const stateOptions = INDIAN_STATES.map(s => el('option', { value: s, ...(customer && customer.state === s ? { selected: 'selected' } : {}) }, [s]));

  const nameInput = el('input', { value: customer ? customer.name : '' });
  const addressInput = el('textarea', { rows: 2 }, [customer ? customer.address || '' : '']);
  const cityInput = el('input', { value: customer ? customer.city || '' : '' });
  const stateSelect = el('select', {}, [el('option', { value: '' }, ['Select state']), ...stateOptions]);
  const pincodeInput = el('input', { value: customer ? customer.pincode || '' : '' });
  const mobileInput = el('input', { value: customer ? customer.mobile || '' : '' });
  const gstinInput = el('input', { value: customer ? customer.gstin || '' : '' });
  const emailInput = el('input', { type: 'email', value: customer ? customer.email || '' : '' });

  const scanBtn = el('button', {
    class: 'btn secondary small', style: 'margin-bottom:14px',
    onclick: () => pickAndScanImage(
      (fields) => {
        if (!nameInput.value.trim() && fields.name) nameInput.value = fields.name;
        if (!addressInput.value.trim() && fields.address) addressInput.value = fields.address;
        if (!cityInput.value.trim() && fields.city) cityInput.value = fields.city;
        if (!stateSelect.value && fields.state) stateSelect.value = fields.state;
        if (!pincodeInput.value.trim() && fields.pincode) pincodeInput.value = fields.pincode;
        if (!mobileInput.value.trim() && fields.mobile) mobileInput.value = fields.mobile;
        if (!gstinInput.value.trim() && fields.gstin) gstinInput.value = fields.gstin;
        if (!emailInput.value.trim() && fields.email) emailInput.value = fields.email;
        scanBtn.textContent = '📷 Scan to fill (business card / GST certificate)';
        scanBtn.disabled = false;
        showToast('Scanned — please double-check the fields below');
      },
      (err) => {
        scanBtn.textContent = '📷 Scan to fill (business card / GST certificate)';
        scanBtn.disabled = false;
        showToast('Scan failed: ' + (err.message || 'could not read image'));
      },
      () => { scanBtn.textContent = 'Scanning...'; scanBtn.disabled = true; },
      (step, total) => { scanBtn.textContent = `Scanning (checking orientation ${step}/${total})...`; }
    )
  }, ['📷 Scan to fill (business card / GST certificate)']);

  const box = el('div', { class: 'modal-box' }, [
    el('h3', {}, [isEdit ? 'Edit Customer' : 'Add Customer']),
    scanBtn,
    el('div', { class: 'field' }, [el('label', {}, ['Name']), nameInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Address']), addressInput]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['City']), cityInput]),
      el('div', { class: 'field' }, [el('label', {}, ['State']), stateSelect])
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Pincode']), pincodeInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Mobile']), mobileInput])
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['GSTIN']), gstinInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Email (for Send)']), emailInput])
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: async () => {
        const payload = {
          name: nameInput.value.trim(), address: addressInput.value.trim(),
          city: cityInput.value.trim(), state: stateSelect.value,
          pincode: pincodeInput.value.trim(), mobile: mobileInput.value.trim(),
          gstin: gstinInput.value.trim(), email: emailInput.value.trim()
        };
        if (!payload.name) { showToast('Name is required'); return; }
        if (isEdit) await window.api.customers.update(customer.id, payload);
        else await window.api.customers.create(payload);
        overlay.remove();
        showToast('Customer saved');
        if (onSaved) onSaved();
      } }, ['Save']),
      el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
    ])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  nameInput.focus();
}
