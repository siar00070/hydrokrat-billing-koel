async function renderProducts(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Products / Items']));

  const searchRow = el('div', { class: 'search-row' });
  const searchInput = el('input', { placeholder: 'Search by description or HSN/SAC...' });
  searchRow.appendChild(searchInput);
  searchRow.appendChild(el('button', { class: 'btn', onclick: () => openProductModal(null, load) }, ['+ Add Product']));
  root.appendChild(searchRow);

  const card = el('div', { class: 'card' });
  root.appendChild(card);

  async function load() {
    card.innerHTML = '';
    const list = await window.api.products.list(searchInput.value.trim());
    if (list.length === 0) {
      card.appendChild(el('div', { class: 'empty-state' }, ['No products found.']));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Description']), el('th', {}, ['HSN/SAC']), el('th', {}, ['Unit']),
        el('th', {}, ['Rate']), el('th', {}, ['GST %']), el('th', {}, [''])
      ])])
    ]);
    const tbody = el('tbody');
    list.forEach(p => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [p.description]),
        el('td', {}, [p.hsn_sac || '-']),
        el('td', {}, [p.unit || '-']),
        el('td', {}, [fmtMoney(p.default_rate)]),
        el('td', {}, [p.gst_percent + '%']),
        el('td', {}, [
          el('div', { class: 'btn-row' }, [
            el('span', { class: 'btn small secondary', onclick: () => openProductModal(p, load) }, ['Edit']),
            el('span', { class: 'btn small danger', onclick: async () => {
              if (confirmDialog(`Delete product "${p.description}"?`)) {
                await window.api.products.delete(p.id);
                showToast('Product deleted');
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

function openProductModal(product, onSaved) {
  const isEdit = !!product;
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });

  const descInput = el('input', { value: product ? product.description : '' });
  const hsnInput = el('input', { value: product ? product.hsn_sac || '' : '' });
  const unitInput = el('input', { value: product ? product.unit || 'Nos' : 'Nos' });
  const rateInput = el('input', { type: 'number', step: '0.01', value: product ? product.default_rate : 0 });
  const gstInput = el('input', { type: 'number', step: '0.01', value: product ? product.gst_percent : 18 });

  const box = el('div', { class: 'modal-box' }, [
    el('h3', {}, [isEdit ? 'Edit Product' : 'Add Product']),
    el('div', { class: 'field' }, [el('label', {}, ['Description']), descInput]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['HSN/SAC']), hsnInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Unit']), unitInput])
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['Default Rate (₹)']), rateInput]),
      el('div', { class: 'field' }, [el('label', {}, ['GST %']), gstInput])
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: async () => {
        const payload = {
          description: descInput.value.trim(), hsn_sac: hsnInput.value.trim(),
          unit: unitInput.value.trim() || 'Nos',
          default_rate: parseFloat(rateInput.value) || 0,
          gst_percent: parseFloat(gstInput.value) || 0
        };
        if (!payload.description) { showToast('Description is required'); return; }
        if (isEdit) await window.api.products.update(product.id, payload);
        else await window.api.products.create(payload);
        overlay.remove();
        showToast('Product saved');
        if (onSaved) onSaved();
      } }, ['Save']),
      el('button', { class: 'btn secondary', onclick: () => overlay.remove() }, ['Cancel'])
    ])
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  descInput.focus();
}
