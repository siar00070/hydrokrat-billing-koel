async function renderSettings(root) {
  root.appendChild(el('h1', { class: 'page-title' }, ['Settings']));
  const settings = await window.api.settings.get();
  const currentBranch = await window.api.branch.get();

  const fields = {};
  function field(labelText, key, opts) {
    opts = opts || {};
    const input = opts.textarea
      ? el('textarea', { rows: opts.rows || 3 }, [settings[key] || ''])
      : el('input', { type: opts.type || 'text', value: settings[key] ?? '' });
    fields[key] = input;
    return el('div', { class: 'field' }, [el('label', {}, [labelText]), input]);
  }

  const scanBtn = el('button', {
    class: 'btn secondary small', style: 'margin-bottom:14px',
    onclick: () => pickAndScanImage(
      (extracted) => {
        if (!fields.name.value.trim() && extracted.name) fields.name.value = extracted.name;
        if (!fields.address_line1.value.trim() && extracted.address) fields.address_line1.value = extracted.address;
        if (!fields.gstin.value.trim() && extracted.gstin) fields.gstin.value = extracted.gstin;
        if (!fields.email.value.trim() && extracted.email) fields.email.value = extracted.email;
        if (!fields.phone1.value.trim() && extracted.mobile) fields.phone1.value = extracted.mobile;
        if (!fields.state.value.trim() && extracted.state) fields.state.value = extracted.state;
        if (!fields.city_state_pincode.value.trim() && (extracted.city || extracted.pincode)) {
          fields.city_state_pincode.value = [extracted.city, extracted.pincode].filter(Boolean).join(' - ');
        }
        scanBtn.textContent = '📷 Scan letterhead / GST certificate to fill';
        scanBtn.disabled = false;
        showToast('Scanned — please double-check the fields below');
      },
      (err) => {
        scanBtn.textContent = '📷 Scan letterhead / GST certificate to fill';
        scanBtn.disabled = false;
        showToast('Scan failed: ' + (err.message || 'could not read image'));
      },
      () => { scanBtn.textContent = 'Scanning...'; scanBtn.disabled = true; },
      (step, total) => { scanBtn.textContent = `Scanning (checking orientation ${step}/${total})...`; }
    )
  }, ['📷 Scan letterhead / GST certificate to fill']);

  const companyCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Company Details']),
    scanBtn,
    field('Company Name', 'name'),
    field('Address Line 1', 'address_line1'),
    field('Address Line 2', 'address_line2'),
    field('Address Line 3', 'address_line3'),
    field('City, State - Pincode', 'city_state_pincode'),
    el('div', { class: 'field-row' }, [field('Phone 1', 'phone1'), field('Phone 2', 'phone2')]),
    field('Email', 'email'),
    el('div', { class: 'field-row' }, [field('GSTIN', 'gstin'), field('State (for GST place-of-supply logic)', 'state')])
  ]);

  const bankCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Bank / Payment Details']),
    field('Bank Name', 'bank_name'),
    field('Account Name', 'account_name'),
    field('Account No', 'account_no'),
    field('IFSC', 'ifsc')
  ]);

  const termsCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Default Terms & Conditions per Document Type']),
    field('Quotation Terms', 'quotation_terms', { textarea: true, rows: 4 }),
    field('Proforma Invoice Terms', 'proforma_terms', { textarea: true, rows: 4 }),
    field('Tax Invoice Terms', 'tax_invoice_terms', { textarea: true, rows: 4 }),
    field('Purchase Order Terms', 'purchase_order_terms', { textarea: true, rows: 4 }),
    field('Techno Commercial Offer Terms', 'techno_commercial_terms', { textarea: true, rows: 4 }),
    field('Default Notes', 'default_notes', { textarea: true, rows: 2 }),
    field('Default GST % for new products', 'default_gst_percent', { type: 'number' })
  ]);

  const branchInput = el('input', { value: currentBranch || '', placeholder: 'e.g. Chennai, Coimbatore' });
  const branchCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['This PC']),
    el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-6px' }, [
      'Stored only on this computer (not synced) — tags documents created here so you can tell branches apart in the Documents list.'
    ]),
    el('div', { class: 'field', style: 'max-width:280px' }, [el('label', {}, ['Branch Name']), branchInput]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', onclick: async () => {
        await window.api.branch.set(branchInput.value.trim());
        showToast('Branch name saved on this PC');
      } }, ['Save Branch Name'])
    ])
  ]);

  function buildImageToggleCard(opts) {
    let dataUri = opts.initialDataUri || null;
    const preview = el('div', { style: 'margin:10px 0' });
    function renderPreview() {
      preview.innerHTML = '';
      if (dataUri) {
        preview.appendChild(el('img', { src: dataUri, style: 'max-height:60px;max-width:220px;border:1px solid #e5e9ee;border-radius:4px;padding:6px;background:#fff' }));
      } else {
        preview.appendChild(el('div', { style: 'font-size:11.5px;color:#6b7280' }, [`No ${opts.label.toLowerCase()} uploaded yet.`]));
      }
    }
    renderPreview();

    const enabledInput = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
    enabledInput.checked = opts.initialEnabled !== false;

    const card = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;color:#0e3a5f' }, [opts.title]),
      el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-6px' }, [opts.description]),
      el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#374151;margin:8px 0;cursor:pointer' }, [
        enabledInput, `Show ${opts.label.toLowerCase()} on documents (turn off to temporarily hide it everywhere without deleting it)`
      ]),
      preview,
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn secondary small', onclick: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            const rawDataUrl = await fileToDataUrl(file);
            const cropped = await cropImageInteractive(rawDataUrl);
            if (cropped) {
              dataUri = cropped;
              renderPreview();
              showToast(`${opts.label} updated — click Save Settings to keep it`);
            }
          });
          input.click();
        } }, ['Upload / Replace']),
        el('button', { class: 'btn secondary small', onclick: () => {
          dataUri = null;
          renderPreview();
        } }, ['Remove'])
      ])
    ]);

    return { card, getDataUri: () => dataUri, getEnabled: () => enabledInput.checked };
  }

  const signatureCtrl = buildImageToggleCard({
    title: 'Digital Signature',
    description: 'Your handwritten signature — prints above "Authorised Signatory" on every document. Each document can also override this individually.',
    label: 'Signature',
    initialDataUri: settings.signature_data_uri,
    initialEnabled: settings.signature_enabled
  });
  const stampCtrl = buildImageToggleCard({
    title: 'Company Stamp / Seal',
    description: 'Your round company stamp/seal — prints alongside the signature. Each document can also override this individually.',
    label: 'Stamp',
    initialDataUri: settings.stamp_data_uri,
    initialEnabled: settings.stamp_enabled
  });

  const hasDeletePassword = await window.api.security.hasDeletePassword();
  const newPasswordInput = el('input', { type: 'password', placeholder: hasDeletePassword ? 'Enter to change' : 'Set a password', style: 'flex:1' });
  const confirmPasswordInput = el('input', { type: 'password', placeholder: 'Confirm', style: 'flex:1' });
  const showPasswordsBtn = el('button', {
    class: 'btn secondary small', type: 'button',
    onclick: () => {
      const showing = newPasswordInput.type === 'text';
      newPasswordInput.type = showing ? 'password' : 'text';
      confirmPasswordInput.type = showing ? 'password' : 'text';
      showPasswordsBtn.textContent = showing ? 'Show' : 'Hide';
    }
  }, ['Show']);
  const securityCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0;color:#0e3a5f' }, ['Security']),
    el('p', { style: 'font-size:11.5px;color:#6b7280;margin-top:-6px' }, [
      hasDeletePassword
        ? 'A password is currently required before permanently deleting anything from Trash.'
        : 'No password set — anyone can permanently delete from Trash right now. Set one below to require it.'
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, ['New Delete Password']), newPasswordInput]),
      el('div', { class: 'field' }, [el('label', {}, ['Confirm Password']), confirmPasswordInput]),
      el('div', { style: 'align-self:flex-end;margin-bottom:12px' }, [showPasswordsBtn])
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn secondary', onclick: async () => {
        if (!newPasswordInput.value) { showToast('Enter a password first'); return; }
        if (newPasswordInput.value !== confirmPasswordInput.value) { showToast('Passwords do not match'); return; }
        await window.api.security.setDeletePassword(newPasswordInput.value);
        showToast('Delete password saved');
        newPasswordInput.value = ''; confirmPasswordInput.value = '';
        newPasswordInput.placeholder = 'Enter to change';
      } }, ['Save Password']),
      hasDeletePassword ? el('button', { class: 'btn secondary', onclick: async () => {
        if (confirmDialog('Remove the delete password? Anyone will then be able to permanently delete without a password.')) {
          await window.api.security.setDeletePassword(null);
          showToast('Delete password removed');
          navigate('settings');
        }
      } }, ['Remove Password']) : null
    ].filter(Boolean))
  ]);

  root.appendChild(companyCard);
  root.appendChild(bankCard);
  root.appendChild(termsCard);
  root.appendChild(signatureCtrl.card);
  root.appendChild(stampCtrl.card);
  root.appendChild(securityCard);
  root.appendChild(branchCard);

  root.appendChild(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn', onclick: async () => {
      const payload = {
        signature_data_uri: signatureCtrl.getDataUri(), signature_enabled: signatureCtrl.getEnabled(),
        stamp_data_uri: stampCtrl.getDataUri(), stamp_enabled: stampCtrl.getEnabled()
      };
      for (const [key, input] of Object.entries(fields)) {
        payload[key] = key === 'default_gst_percent' ? (parseFloat(input.value) || 0) : input.value;
      }
      await window.api.settings.update(payload);
      showToast('Settings saved');
    } }, ['Save Settings'])
  ]));
}
