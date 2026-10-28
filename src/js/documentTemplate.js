const DOC_LABEL = {
  quotation: 'QUOTATION',
  proforma: 'PROFORMA INVOICE',
  tax_invoice: 'TAX INVOICE',
  delivery_challan: 'DELIVERY CHALLAN',
  purchase_order: 'PURCHASE ORDER',
  techno_commercial: 'TECHNO COMMERCIAL OFFER'
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtMoney(n) {
  const num = Number(n) || 0;
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function stateWithCode(stateName) {
  if (!stateName) return '';
  const codes = (typeof INDIAN_STATE_CODES !== 'undefined') ? INDIAN_STATE_CODES : {};
  const code = codes[stateName];
  return code ? `${stateName}, Code: ${code}` : stateName;
}

// Every item's description supports a free-typed multi-line block (first
// line = bold title, remaining lines = detail lines) OR, per item, a set of
// fixed pump-spec fields (Flow & Head, Model, KW & RPM, MOC) shown with bold
// static labels. Independently of that, Engine Spec and Engine Accessories
// (for diesel-engine-driven pumps) each have their own on/off toggle and can
// be combined with either mode above.
function buildItemDescHtml(it) {
  const descLines = String(it.description || '').split('\n').map(l => l.trim()).filter(Boolean);
  const title = descLines[0] ? `<div class="item-title">${esc(descLines[0])}</div>` : '';

  let detailsHtml;
  if (it.use_structured_specs) {
    const specs = [
      ['Flow & Head', it.spec_flow_head],
      ['Model', it.spec_model],
      ['KW & RPM', it.spec_kw_rpm],
      ['MOC', it.spec_moc]
    ].filter(([, v]) => v);
    detailsHtml = specs.map(([label, v]) => `<div class="item-detail"><strong>${esc(label)}:</strong> ${esc(v)}</div>`).join('');
  } else {
    detailsHtml = descLines.slice(1).map(l => `<div class="item-detail">${esc(l)}</div>`).join('');
  }

  const engineFields = [
    it.use_engine_spec ? ['Engine Spec', it.spec_engine] : null,
    it.use_engine_accessories ? ['Engine Accessories', it.spec_engine_accessories] : null,
    it.use_accessories ? ['Accessories', it.spec_accessories] : null
  ].filter(pair => pair && pair[1]);
  const engineHtml = engineFields.map(([label, v]) => `<div class="item-detail"><strong>${esc(label)}:</strong> ${esc(v)}</div>`).join('');
  const serialHtml = Array.isArray(it.serial_nos) && it.serial_nos.length
    ? `<div class="item-detail"><strong>Sl. No:</strong> ${esc(it.serial_nos.join(', '))}</div>` : '';

  return title + detailsHtml + engineHtml + serialHtml;
}

function buildDocumentHtml(doc, settings, customer, cssText) {
  if (doc.doc_type === 'purchase_order') return buildPurchaseOrderHtml(doc, settings, cssText);

  const label = DOC_LABEL[doc.doc_type] || 'DOCUMENT';
  const isTaxInvoice = doc.doc_type === 'tax_invoice';
  const isDeliveryChallan = doc.doc_type === 'delivery_challan';
  const showValidUntil = doc.doc_type !== 'tax_invoice' && doc.doc_type !== 'delivery_challan' && doc.valid_until;

  const itemRows = (doc.items || []).map((it, idx) => `
    <tr>
      <td class="num">${idx + 1}</td>
      <td>${buildItemDescHtml(it)}</td>
      <td>${esc(it.hsn_sac)}</td>
      <td class="num">${esc(it.qty)}</td>
      <td class="num">${fmtMoney(it.rate)}</td>
      <td class="num">${esc(it.gst_percent)}%</td>
      <td class="num">${fmtMoney(it.amount)}</td>
    </tr>
  `).join('');

  const gstRows = doc.igst > 0
    ? `<div class="row"><span>IGST</span><span>${fmtMoney(doc.igst)}</span></div>`
    : `<div class="row"><span>CGST</span><span>${fmtMoney(doc.cgst)}</span></div>
       <div class="row"><span>SGST</span><span>${fmtMoney(doc.sgst)}</span></div>`;

  // HSN-wise tax summary (Tax Invoice only) — same grouping logic as the
  // GSTR-1 Excel export in main.js's export:gstr1_excel handler.
  let hsnSummaryHtml = '';
  if (isTaxInvoice) {
    const sameState = doc.igst <= 0;
    const byHsn = {};
    (doc.items || []).forEach(it => {
      const key = it.hsn_sac || '(none)';
      if (!byHsn[key]) byHsn[key] = { taxable: 0, rate: Number(it.gst_percent) || 0 };
      byHsn[key].taxable += Number(it.amount) || 0;
    });
    const hsnRows = Object.entries(byHsn).map(([hsn, v]) => {
      const half = v.rate / 2;
      const cgstAmt = sameState ? v.taxable * half / 100 : 0;
      const sgstAmt = sameState ? v.taxable * half / 100 : 0;
      const igstAmt = sameState ? 0 : v.taxable * v.rate / 100;
      const totalTax = cgstAmt + sgstAmt + igstAmt;
      return `<tr>
        <td>${esc(hsn)}</td>
        <td class="num">${fmtMoney(v.taxable)}</td>
        ${sameState ? `
          <td class="num">${half}%</td><td class="num">${fmtMoney(cgstAmt)}</td>
          <td class="num">${half}%</td><td class="num">${fmtMoney(sgstAmt)}</td>
        ` : `
          <td class="num">${v.rate}%</td><td class="num">${fmtMoney(igstAmt)}</td>
        `}
        <td class="num">${fmtMoney(totalTax)}</td>
      </tr>`;
    }).join('');
    hsnSummaryHtml = `
      <table class="hsn-summary-table">
        <thead>
          <tr>
            <th>HSN/SAC</th><th class="num">Taxable Value</th>
            ${sameState ? '<th class="num">CGST Rate</th><th class="num">CGST Amt</th><th class="num">SGST Rate</th><th class="num">SGST Amt</th>' : '<th class="num">IGST Rate</th><th class="num">IGST Amt</th>'}
            <th class="num">Total Tax</th>
          </tr>
        </thead>
        <tbody>${hsnRows}</tbody>
      </table>
    `;
  }

  const showAmountWords = !isDeliveryChallan && typeof amountToWords !== 'undefined';
  const amountWordsHtml = showAmountWords ? `
    <div class="amount-words">
      <strong>Amount Chargeable (in words):</strong> ${esc(amountToWords(doc.total))}
      ${isTaxInvoice ? `<br><strong>Tax Amount (in words):</strong> ${esc(amountToWords(doc.cgst + doc.sgst + doc.igst))}` : ''}
    </div>
  ` : '';

  const declarationHtml = isTaxInvoice ? `
    <div class="declaration">
      We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
    </div>
  ` : '';

  const sellerStateLine = isTaxInvoice ? `State: ${esc(stateWithCode(settings.state))}<br>` : '';
  const buyerStateLine = isTaxInvoice && customer && customer.state ? `, ${esc(stateWithCode(customer.state))}` : (customer && customer.state ? `, ${esc(customer.state)}` : '');

  const bottomLeftBox = isDeliveryChallan ? `
    <div class="payment-box">
      <div class="title">Transport Details</div>
      Vehicle No: ${esc(doc.vehicle_no || '-')}<br>
      Transporter: ${esc(doc.transporter_name || '-')}<br>
      Driver: ${esc(doc.driver_name || '-')}${doc.driver_contact ? ' (' + esc(doc.driver_contact) + ')' : ''}<br>
      Place of Delivery: ${esc(doc.place_of_delivery || '-')}<br>
      Reason for Transport: ${esc(doc.transport_reason || '-')}
    </div>
  ` : `
    <div class="payment-box">
      <div class="title">Payment Details</div>
      Bank: ${esc(settings.bank_name)}<br>
      Account Name: ${esc(settings.account_name)}<br>
      Account No: ${esc(settings.account_no)}<br>
      IFSC: ${esc(settings.ifsc)}
    </div>
  `;

  const totalsBoxRows = isDeliveryChallan
    ? `<div class="row"><span>Subtotal</span><span>${fmtMoney(doc.subtotal)}</span></div>
       <div class="row total"><span>Total</span><span>${fmtMoney(doc.total)}</span></div>`
    : `<div class="row"><span>Subtotal</span><span>${fmtMoney(doc.subtotal)}</span></div>
       <div class="row"><span>Discount</span><span>${fmtMoney(doc.discount)}</span></div>
       ${gstRows}
       <div class="row"><span>Round off</span><span>${fmtMoney(doc.round_off)}</span></div>
       <div class="row total"><span>Total</span><span>${fmtMoney(doc.total)}</span></div>`;

  const signatureAllowed = settings.signature_enabled !== false && doc.include_signature !== false;
  const signatureImgHtml = (signatureAllowed && typeof settings.signature_data_uri === 'string' && settings.signature_data_uri)
    ? `<img src="${settings.signature_data_uri}" class="signature-img" alt="Signature">`
    : '';
  const stampAllowed = settings.stamp_enabled !== false && doc.include_stamp !== false;
  const stampImgHtml = (stampAllowed && typeof settings.stamp_data_uri === 'string' && settings.stamp_data_uri)
    ? `<img src="${settings.stamp_data_uri}" class="stamp-img" alt="Stamp">`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(doc.doc_number)}</title>
<style>${cssText}</style>
</head>
<body>
<div class="doc-page">
  ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="doc-watermark" alt="">` : ''}
  <div class="doc-header">
    <div>
      ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="seller-logo" alt="${esc(settings.name)}">` : ''}
      <p class="seller-name">${esc(settings.name)}</p>
      <div class="seller-details">
        ${esc(settings.address_line1)}<br>
        ${esc(settings.address_line2)}<br>
        ${esc(settings.address_line3)}<br>
        ${esc(settings.city_state_pincode)}<br>
        ${esc(settings.phone1)}${settings.phone2 ? ', ' + esc(settings.phone2) : ''}<br>
        ${esc(settings.email)}<br>
        GSTIN: ${esc(settings.gstin)}<br>
        ${sellerStateLine}
      </div>
    </div>
    <div class="doc-title-box">
      <div class="doc-title">${label}</div>
      <div class="doc-number-pill">${esc(doc.doc_number)}</div>
      ${doc.is_revised ? `<div class="revised-tag">REVISED (Rev.${esc(doc.revision_no || 1)})</div>` : ''}
      ${doc.doc_type === 'techno_commercial' && typeof BRAND_LOGO_DATA_URI !== 'undefined' && BRAND_LOGO_DATA_URI ? `<img src="${BRAND_LOGO_DATA_URI}" class="brand-mfr-logo" alt="KOEL">` : ''}
    </div>
  </div>

  <div class="doc-meta-row">
    <div class="bill-to">
      <div class="label">BILL TO</div>
      <div class="cust-name">${esc(customer ? customer.name : '')}</div>
      <div class="cust-details">
        ${esc(customer ? customer.address : '')}<br>
        ${esc(customer ? [customer.city, customer.pincode].filter(Boolean).join(' - ') : '')}${buyerStateLine}<br>
        ${customer && customer.mobile ? 'Mobile No: ' + esc(customer.mobile) + '<br>' : ''}
        ${customer && customer.gstin ? 'GSTIN: ' + esc(customer.gstin) : ''}
      </div>
      <div class="label" style="margin-top:10px">SHIP TO</div>
      ${doc.ship_to_same === false ? `
      <div class="cust-name">${esc(doc.ship_to_name || (customer ? customer.name : ''))}</div>
      <div class="cust-details">
        ${esc(doc.ship_to_address || '')}<br>
        ${esc([doc.ship_to_city, doc.ship_to_pincode].filter(Boolean).join(' - '))}${doc.ship_to_state ? ', ' + esc(stateWithCode(doc.ship_to_state)) : ''}
      </div>` : `
      <div class="cust-details">Same as billing address</div>`}
    </div>
    <div class="meta-fields">
      <div class="meta-item"><span class="label">DATE&nbsp;&nbsp;</span><span class="value">${fmtDate(doc.doc_date)}</span></div>
      ${showValidUntil ? `<div class="meta-item"><span class="label">VALID UNTIL&nbsp;&nbsp;</span><span class="value">${fmtDate(doc.valid_until)}</span></div>` : ''}
      <div class="meta-item"><span class="label">PLACE OF SUPPLY&nbsp;&nbsp;</span><span class="value">${esc(doc.place_of_supply)}</span></div>
      ${doc.project_name ? `<div class="meta-item"><span class="label">PROJECT&nbsp;&nbsp;</span><span class="value">${esc(doc.project_name)}</span></div>` : ''}
      ${doc.enquiry_no ? `<div class="meta-item"><span class="label">ENQUIRY NO&nbsp;&nbsp;</span><span class="value">${esc(doc.enquiry_no)}</span></div>` : ''}
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th class="num">Sr</th>
        <th>Description</th>
        <th>HSN/SAC</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">GST %</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  ${hsnSummaryHtml}

  <div class="doc-bottom">
    ${bottomLeftBox}
    <div class="totals-box">
      ${totalsBoxRows}
    </div>
  </div>

  ${amountWordsHtml}
  ${declarationHtml}

  <div class="doc-footer">
    <div class="terms-col">
      <div class="title">Terms &amp; Conditions</div>
      ${esc(doc.terms).split('\n').map(l => esc(l)).join('<br>')}
    </div>
    <div class="notes-col">
      <div class="title">Notes</div>
      ${esc(doc.notes).split('\n').map(l => esc(l)).join('<br>')}
    </div>
    <div class="signatory-col">
      <div class="prepared-by">PREPARED BY <strong>${esc(settings.name)}</strong></div>
      ${(stampImgHtml || signatureImgHtml) ? `<div class="sign-stamp-row">${stampImgHtml}${signatureImgHtml}</div>` : ''}
      <div class="signatory-label">Authorised Signatory</div>
    </div>
  </div>

  ${isTaxInvoice ? '<div class="computer-generated">This is a Computer Generated Invoice</div>' : ''}
</div>
</body>
</html>`;
}

// Purchase Order is HV -> Supplier, the reverse direction of every other
// document (which are all HV -> Customer). It shares the same navy/teal
// theme and helper functions, but reads as a formal order letter rather
// than an invoice — a single flowing column instead of the boxed
// bill-to/meta-fields split the other document types use.
function buildPurchaseOrderHtml(doc, settings, cssText) {
  const supplier = doc.supplier_snapshot || null;

  const itemRows = (doc.items || []).map((it, idx) => `
    <tr>
      <td class="num">${idx + 1}</td>
      <td>${buildItemDescHtml(it)}</td>
      <td>${esc(it.hsn_sac)}</td>
      <td class="num">${esc(it.qty)}</td>
      <td class="num">${fmtMoney(it.rate)}</td>
      <td class="num">${esc(it.gst_percent)}%</td>
      <td class="num">${fmtMoney(it.amount)}</td>
    </tr>
  `).join('');

  const gstRows = doc.igst > 0
    ? `<div class="row"><span>IGST</span><span>${fmtMoney(doc.igst)}</span></div>`
    : `<div class="row"><span>CGST</span><span>${fmtMoney(doc.cgst)}</span></div>
       <div class="row"><span>SGST</span><span>${fmtMoney(doc.sgst)}</span></div>`;

  const deliverToName = doc.deliver_to_same === false ? (doc.deliver_to_name || settings.name) : settings.name;
  const deliverToDetails = doc.deliver_to_same === false
    ? `${esc(doc.deliver_to_address || '')}<br>${esc([doc.deliver_to_city, doc.deliver_to_pincode].filter(Boolean).join(' - '))}${doc.deliver_to_state ? ', ' + esc(stateWithCode(doc.deliver_to_state)) : ''}`
    : `${esc(settings.address_line1)}<br>${esc(settings.city_state_pincode)}`;

  const signatureAllowed = settings.signature_enabled !== false && doc.include_signature !== false;
  const signatureImgHtml = (signatureAllowed && typeof settings.signature_data_uri === 'string' && settings.signature_data_uri)
    ? `<img src="${settings.signature_data_uri}" class="signature-img" alt="Signature">`
    : '';
  const stampAllowed = settings.stamp_enabled !== false && doc.include_stamp !== false;
  const stampImgHtml = (stampAllowed && typeof settings.stamp_data_uri === 'string' && settings.stamp_data_uri)
    ? `<img src="${settings.stamp_data_uri}" class="stamp-img" alt="Stamp">`
    : '';

  const commercialTermRows = [
    ['Price Basis', doc.price_basis], ['Terms of Payment', doc.payment_terms],
    ['Packing', doc.packing_terms], ['Freight', doc.freight_terms], ['Scope of Supply', doc.scope_of_supply], ['Warranty', doc.warranty_terms],
    ['Delivery Schedule', doc.delivery_schedule]
  ].filter(([, v]) => v);
  const commercialTermsHtml = commercialTermRows.length > 0 ? `
  <table class="po-commercial-table">
    ${commercialTermRows.map(([label, v]) => `<tr><td class="label">${esc(label)}</td><td>${esc(v).split('\n').join('<br>')}</td></tr>`).join('')}
  </table>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(doc.doc_number)}</title>
<style>${cssText}</style>
</head>
<body>
<div class="doc-page">
  ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="doc-watermark" alt="">` : ''}
  <div class="doc-header">
    <div>
      ${typeof HV_LOGO_DATA_URI !== 'undefined' ? `<img src="${HV_LOGO_DATA_URI}" class="seller-logo" alt="${esc(settings.name)}">` : ''}
    </div>
    <div class="doc-title-box">
      <div class="doc-title">PURCHASE ORDER</div>
      <div class="doc-number-pill">${esc(doc.doc_number)}</div>
      ${typeof BRAND_LOGO_DATA_URI !== 'undefined' && BRAND_LOGO_DATA_URI ? `<img src="${BRAND_LOGO_DATA_URI}" class="brand-mfr-logo" alt="KOEL">` : ''}
    </div>
  </div>

  <div class="po-parties po-parties-3col">
    <div class="po-party">
      <div class="po-party-label">VENDOR / SUPPLIER</div>
      <div class="po-party-name">${esc(supplier ? supplier.name : '')}</div>
      <div class="po-party-details">
        ${esc(supplier ? supplier.address : '')}<br>
        ${esc(supplier ? [supplier.city, supplier.pincode].filter(Boolean).join(' - ') : '')}${supplier && supplier.state ? ', ' + esc(stateWithCode(supplier.state)) : ''}<br>
        ${supplier && supplier.contact_person ? 'Contact Person: ' + esc(supplier.contact_person) + '<br>' : ''}
        ${supplier && supplier.mobile ? 'Mobile No: ' + esc(supplier.mobile) + '<br>' : ''}
        ${supplier && supplier.gstin ? 'GSTIN: ' + esc(supplier.gstin) : ''}
      </div>
      <div class="po-party-meta">
        <div><span class="label">PO NO</span> ${esc(doc.doc_number)}</div>
        <div><span class="label">DATE</span> ${fmtDate(doc.doc_date)}</div>
      </div>
    </div>
    <div class="po-party">
      <div class="po-party-label">BILLING ADDRESS</div>
      <div class="po-party-name">${esc(settings.name)}</div>
      <div class="po-party-details">
        ${esc(settings.address_line1)}<br>
        ${esc(settings.city_state_pincode)}<br>
        ${settings.phone1 ? 'Mobile No: ' + esc(settings.phone1) + (settings.phone2 ? ', ' + esc(settings.phone2) : '') + '<br>' : ''}
        GSTIN: ${esc(settings.gstin)}
      </div>
      <div class="po-party-meta">
        <div><span class="label">PROJECT</span> ${esc(doc.project_name) || '-'}</div>
        <div><span class="label">QUOTATION REF</span> ${esc(doc.enquiry_no) || '-'}</div>
      </div>
    </div>
    <div class="po-party">
      <div class="po-party-label">DELIVERY</div>
      <div class="po-party-name">${esc(deliverToName)}</div>
      <div class="po-party-details">${deliverToDetails}</div>
      <div class="po-party-meta">
        <div><span class="label">DELIVERY TYPE</span> ${esc(doc.delivery_type) || '-'}</div>
        <div><span class="label">TRANSPORTATION</span> ${esc(doc.transportation) || '-'}</div>
      </div>
    </div>
  </div>

  <div class="po-intro">
    Dear Sir/Madam,<br>
    Please arrange to supply the following as per the terms and conditions mentioned below.
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th class="num">Sr</th>
        <th>Description</th>
        <th>HSN/SAC</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">GST %</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="po-totals-row">
    <div class="totals-box">
      <div class="row"><span>Subtotal</span><span>${fmtMoney(doc.subtotal)}</span></div>
      <div class="row"><span>Discount</span><span>${fmtMoney(doc.discount)}</span></div>
      ${gstRows}
      <div class="row"><span>Round off</span><span>${fmtMoney(doc.round_off)}</span></div>
      <div class="row total"><span>Total</span><span>${fmtMoney(doc.total)}</span></div>
    </div>
  </div>

  ${typeof amountToWords !== 'undefined' ? `
  <div class="amount-words">
    <strong>Amount Chargeable (in words):</strong> ${esc(amountToWords(doc.total))}
  </div>` : ''}

  ${commercialTermsHtml}

  <div class="po-terms-notes">
    <div class="title">Terms &amp; Conditions</div>
    ${esc(doc.terms).split('\n').map(l => esc(l)).join('<br>')}
    ${doc.notes ? `<div class="title" style="margin-top:10px">Notes</div>${esc(doc.notes).split('\n').map(l => esc(l)).join('<br>')}` : ''}
  </div>

  <div class="po-thanking">Kindly acknowledge receipt of this order and return the duplicate copy duly signed and sealed as a token of acceptance.</div>
  <div class="po-closing-row po-closing-row-3">
    <div class="po-closing-col">
      <div class="po-vendor-acceptance-line"></div>
      <div class="signatory-label">Prepared By</div>
    </div>
    <div class="po-closing-col">
      <div class="po-vendor-acceptance-line"></div>
      <div class="signatory-label">Verified By</div>
    </div>
    <div class="po-closing-col">
      ${(stampImgHtml || signatureImgHtml) ? `<div class="sign-stamp-row">${stampImgHtml}${signatureImgHtml}</div>` : '<div class="po-vendor-acceptance-line"></div>'}
      <div class="signatory-label">Approved By</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function pdfFilenameFor(doc) {
  const partyName = (doc.customer_snapshot && doc.customer_snapshot.name) || (doc.supplier_snapshot && doc.supplier_snapshot.name);
  const safeName = partyName ? partyName.replace(/[\\/:*?"<>|]/g, '').trim() : '';
  const base = safeName ? `${safeName}_${doc.doc_number}` : doc.doc_number;
  return doc.is_revised ? `${base}_Revised Offer` : base;
}

async function downloadDocumentPdf(docId) {
  const doc = await window.api.documents.get(docId);
  const settings = await window.api.settings.get();
  const customer = doc.customer_snapshot || null;
  const cssText = await fetch('css/document-theme.css').then(r => r.text());
  const html = buildDocumentHtml(doc, settings, customer, cssText);
  return window.api.document.savePdf(html, pdfFilenameFor(doc), doc.doc_type);
}

if (typeof module !== 'undefined') module.exports = { buildDocumentHtml, DOC_LABEL, fmtMoney, fmtDate, pdfFilenameFor };
