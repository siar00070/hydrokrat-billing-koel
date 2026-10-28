// Same prefixes as the KSB app: both apps share one numbering series (see numberingClient).
const PREFIXES = { quotation: 'QT-HV', proforma: 'PI-HV', tax_invoice: 'TI-HV', delivery_challan: 'DC-HV', purchase_order: 'PO-HV', techno_commercial: 'TCO-HV' };

// numberingClient: the Supabase client whose `counters` table issues document
// numbers (the KSB project), so KSB and KOEL documents share one series.
// Documents that take serial-numbered units out of stock.
const STOCK_OUT_TYPES = ['tax_invoice', 'delivery_challan'];

function normalizeSerial(s) {
  return String(s || '').trim().replace(/s+/g, ' ').toUpperCase();
}

function createRemoteStore(client, numberingClient = client) {
  async function currentUserId() {
    const { data } = await client.auth.getSession();
    return data.session ? data.session.user.id : null;
  }

  function unwrap({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  // If the document being deleted holds the highest sequence number issued
  // so far for its doc_type+year, roll the counter back by one so the next
  // document created reuses that number instead of leaving a permanent gap.
  // Only the single most-recently-issued number is ever reclaimed this way —
  // deleting an older document never touches the counter — so the original
  // multi-branch guarantee (two branches can never be handed the same number)
  // stays intact except for this one narrow, low-risk case.
  async function rollBackCounterIfLatest(docType, docNumber) {
    const parts = String(docNumber || '').split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    if (!seq || !year) return;
    const { data } = await numberingClient.from('counters').select('last_seq').eq('doc_type', docType).eq('year', year).maybeSingle();
    if (data && data.last_seq === seq) {
      await numberingClient.from('counters').update({ last_seq: seq - 1 }).eq('doc_type', docType).eq('year', year);
    }
  }

  return {
    // ---- Company settings ----
    async getSettings() {
      const data = unwrap(await client.from('company_settings').select('*').eq('id', 1).single());
      return data;
    },
    async updateSettings(fields) {
      const uid = await currentUserId();
      const data = unwrap(await client.from('company_settings')
        .update({ ...fields, updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', 1)
        .select()
        .single());
      return data;
    },

    // ---- Customers ----
    async listCustomers(search) {
      let q = client.from('customers').select('*').order('name');
      if (search) q = q.or(`name.ilike.%${search}%,gstin.ilike.%${search}%`);
      return unwrap(await q);
    },
    async getCustomer(id) {
      const { data, error } = await client.from('customers').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async createCustomer(c) {
      const uid = await currentUserId();
      return unwrap(await client.from('customers')
        .insert({ ...normalizeCustomer(c), created_by: uid, updated_by: uid })
        .select().single());
    },
    async updateCustomer(id, c) {
      const uid = await currentUserId();
      return unwrap(await client.from('customers')
        .update({ ...normalizeCustomer(c), updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id).select().single());
    },
    async deleteCustomer(id) {
      unwrap(await client.from('customers').delete().eq('id', id));
      return true;
    },

    // ---- Suppliers ----
    async listSuppliers(search) {
      let q = client.from('suppliers').select('*').order('name');
      if (search) q = q.or(`name.ilike.%${search}%,gstin.ilike.%${search}%`);
      return unwrap(await q);
    },
    async getSupplier(id) {
      const { data, error } = await client.from('suppliers').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async createSupplier(s) {
      const uid = await currentUserId();
      return unwrap(await client.from('suppliers')
        .insert({ ...normalizeSupplier(s), created_by: uid, updated_by: uid })
        .select().single());
    },
    async updateSupplier(id, s) {
      const uid = await currentUserId();
      return unwrap(await client.from('suppliers')
        .update({ ...normalizeSupplier(s), updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id).select().single());
    },
    async deleteSupplier(id) {
      unwrap(await client.from('suppliers').delete().eq('id', id));
      return true;
    },

    // ---- Products ----
    async listProducts(search) {
      let q = client.from('products').select('*').order('description');
      if (search) q = q.or(`description.ilike.%${search}%,hsn_sac.ilike.%${search}%`);
      return unwrap(await q);
    },
    async createProduct(p) {
      const uid = await currentUserId();
      return unwrap(await client.from('products')
        .insert({ ...normalizeProduct(p), created_by: uid, updated_by: uid })
        .select().single());
    },
    async updateProduct(id, p) {
      const uid = await currentUserId();
      return unwrap(await client.from('products')
        .update({ ...normalizeProduct(p), updated_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id).select().single());
    },
    async deleteProduct(id) {
      unwrap(await client.from('products').delete().eq('id', id));
      return true;
    },

    // ---- Documents ----
    async listDocuments(filters) {
      filters = filters || {};
      let q = client.from('documents').select('*').is('deleted_at', null).order('id', { ascending: false });
      if (filters.docType) q = q.eq('doc_type', filters.docType);
      if (filters.search) q = q.ilike('doc_number', `%${filters.search}%`);
      const rows = unwrap(await q);
      return rows.map(d => ({
        ...d,
        customer_name: d.customer_snapshot ? d.customer_snapshot.name : null,
        supplier_name: d.supplier_snapshot ? d.supplier_snapshot.name : null
      }));
    },
    async listDeletedDocuments() {
      const rows = unwrap(await client.from('documents').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }));
      return rows.map(d => ({
        ...d,
        customer_name: d.customer_snapshot ? d.customer_snapshot.name : null,
        supplier_name: d.supplier_snapshot ? d.supplier_snapshot.name : null
      }));
    },
    async getDocument(id) {
      const { data: doc, error } = await client.from('documents').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!doc) return null;
      const items = unwrap(await client.from('document_items').select('*').eq('document_id', id).order('sort_order'));
      return { ...doc, items };
    },
    async peekNextDocNumber(docType, year) {
      const { data } = await numberingClient.from('counters').select('last_seq').eq('doc_type', docType).eq('year', year).maybeSingle();
      const seq = (data ? data.last_seq : 0) + 1;
      return formatDocNumber(docType, year, seq);
    },
    async nextDocNumber(docType, year) {
      const { data, error } = await numberingClient.rpc('next_doc_number', { p_doc_type: docType, p_year: year });
      if (error) throw new Error(error.message);
      return formatDocNumber(docType, year, data);
    },
    async saveDocument(record, existingId) {
      const uid = await currentUserId();
      const { items, ...docFields } = record;
      let docId = existingId;

      let oldItemIds = [];

      if (existingId) {
        unwrap(await client.from('documents')
          .update({ ...docFields, updated_at: new Date().toISOString(), updated_by: uid })
          .eq('id', existingId));
        oldItemIds = unwrap(await client.from('document_items').select('id').eq('document_id', existingId)).map(r => r.id);
      } else {
        const created = unwrap(await client.from('documents')
          .insert({ ...docFields, created_by: uid, updated_by: uid })
          .select().single());
        docId = created.id;
      }

      // New items go in before the old ones are removed, and a failed first save is undone,
      // so an error never leaves an empty document behind or burns a document number.
      try {
        if (items && items.length > 0) {
          const rows = items.map(it => ({ ...it, document_id: docId }));
          unwrap(await client.from('document_items').insert(rows));
        }
      } catch (err) {
        if (!existingId) {
          await client.from('documents').delete().eq('id', docId);
          await rollBackCounterIfLatest(docFields.doc_type, docFields.doc_number);
        }
        throw err;
      }
      if (oldItemIds.length > 0) {
        unwrap(await client.from('document_items').delete().in('id', oldItemIds));
      }

      return this.getDocument(docId);
    },
    async deleteDocument(id) {
      const uid = await currentUserId();
      const doc = unwrap(await client.from('documents').select('doc_type, doc_number').eq('id', id).single());
      unwrap(await client.from('documents')
        .update({ deleted_at: new Date().toISOString(), updated_by: uid })
        .eq('id', id));
      await rollBackCounterIfLatest(doc.doc_type, doc.doc_number);
      if (STOCK_OUT_TYPES.includes(doc.doc_type)) await this.syncDocumentStock(id, doc.doc_type, [], false);
      return true;
    },
    async restoreDocument(id) {
      const uid = await currentUserId();
      const doc = unwrap(await client.from('documents').select('doc_number, doc_type').eq('id', id).single());
      const clashes = unwrap(await client.from('documents')
        .select('id').eq('doc_number', doc.doc_number).is('deleted_at', null).neq('id', id));
      if (clashes.length > 0) {
        throw new Error(`Cannot restore — ${doc.doc_number} has already been reused by a newer document. Use "Duplicate As" to recreate this one under a new number instead.`);
      }
      const isStockOut = STOCK_OUT_TYPES.includes(doc.doc_type);
      const serials = isStockOut ? await this.documentSerials(id) : [];
      if (serials.length > 0) {
        const problem = await this.syncDocumentStock(id, doc.doc_type, serials, true);
        if (problem) throw new Error(`Cannot restore ${doc.doc_number} — ${problem}`);
      }
      unwrap(await client.from('documents')
        .update({ deleted_at: null, updated_by: uid })
        .eq('id', id));
      if (serials.length > 0) await this.syncDocumentStock(id, doc.doc_type, serials, false);
      return true;
    },
    async purgeDocument(id) {
      unwrap(await client.from('documents').delete().eq('id', id));
      return true;
    },

    // ---- Stock ----
    // Returns null when OK, otherwise a message naming the serials that can't be used (see sync_document_stock).
    async syncDocumentStock(docId, docType, serials, dryRun) {
      const { data, error } = await client.rpc('sync_document_stock', {
        p_doc_id: docId, p_doc_type: docType, p_serials: serials, p_dry_run: !!dryRun
      });
      if (error) throw new Error(error.message);
      return data || null;
    },
    async documentSerials(docId) {
      const rows = unwrap(await client.from('document_items').select('serial_nos').eq('document_id', docId));
      return [...new Set(rows.flatMap(r => r.serial_nos || []))];
    },
    async listStockUnits(search) {
      let q = client.from('stock_units')
        .select('*, purchase_invoices(invoice_no, invoice_date, supplier_snapshot, po_number), documents(id, doc_number, doc_type)')
        .order('description').order('serial_no');
      if (search) q = q.or(`serial_no.ilike.%${search}%,description.ilike.%${search}%`);
      return unwrap(await q);
    },
    async listPurchaseInvoices() {
      const rows = unwrap(await client.from('purchase_invoices')
        .select('*, stock_units(id, out_document_id)')
        .order('invoice_date', { ascending: false }).order('id', { ascending: false }));
      return rows.map(({ stock_units: units, ...inv }) => ({
        ...inv,
        supplier_name: inv.supplier_snapshot ? inv.supplier_snapshot.name : null,
        unit_count: units.length,
        in_stock_count: units.filter(u => !u.out_document_id).length
      }));
    },
    // inv: { supplier_id, po_document_id, invoice_no, invoice_date, notes,
    //        lines: [{ product_id, description, hsn_sac, rate, serials: [] }] } — one serial per unit.
    async createPurchaseInvoice(inv) {
      const uid = await currentUserId();
      const lines = (inv.lines || []).map(l => ({ ...l, serials: (l.serials || []).map(normalizeSerial).filter(Boolean) }));
      const all = lines.flatMap(l => l.serials);
      if (!inv.invoice_no || !inv.invoice_date) throw new Error('Invoice number and date are required');
      if (all.length === 0) throw new Error('Add at least one serial number');
      const dupes = all.filter((s, i) => all.indexOf(s) !== i);
      if (dupes.length) throw new Error(`Serial entered twice: ${[...new Set(dupes)].join(', ')}`);
      const existing = [];
      for (let i = 0; i < all.length; i += 200) {
        const rows = unwrap(await client.from('stock_units').select('serial_no').in('serial_no', all.slice(i, i + 200)));
        existing.push(...rows.map(r => r.serial_no));
      }
      if (existing.length) throw new Error(`Already in the system: ${existing.join(', ')}`);

      const supplier = inv.supplier_id
        ? unwrap(await client.from('suppliers').select('*').eq('id', inv.supplier_id).maybeSingle()) : null;
      const po = inv.po_document_id
        ? unwrap(await client.from('documents').select('doc_number').eq('id', inv.po_document_id).maybeSingle()) : null;
      const header = unwrap(await client.from('purchase_invoices').insert({
        supplier_id: inv.supplier_id || null, supplier_snapshot: supplier || null,
        po_document_id: inv.po_document_id || null, po_number: po ? po.doc_number : null,
        invoice_no: String(inv.invoice_no).trim(), invoice_date: inv.invoice_date,
        notes: inv.notes || null, created_by: uid
      }).select().single());
      const units = lines.flatMap(l => l.serials.map(serial => ({
        purchase_invoice_id: header.id, product_id: l.product_id || null,
        description: l.description, hsn_sac: l.hsn_sac || null, serial_no: serial,
        purchase_rate: Number(l.rate) || 0, created_by: uid
      })));
      try {
        unwrap(await client.from('stock_units').insert(units));
      } catch (err) {
        await client.from('purchase_invoices').delete().eq('id', header.id);
        throw err;
      }
      return { ...header, unit_count: units.length };
    },
    async deletePurchaseInvoice(id) {
      const used = unwrap(await client.from('stock_units').select('serial_no').eq('purchase_invoice_id', id).not('out_document_id', 'is', null));
      if (used.length) throw new Error(`Cannot delete — already sold/delivered: ${used.map(u => u.serial_no).join(', ')}`);
      unwrap(await client.from('purchase_invoices').delete().eq('id', id));
      return true;
    },
    async setPaymentStatus(id, status, details) {
      const uid = await currentUserId();
      const fields = { payment_status: status, updated_at: new Date().toISOString(), updated_by: uid };
      if (status === 'paid' || status === 'partial') {
        fields.payment_date = (details && details.payment_date) || new Date().toISOString().slice(0, 10);
        fields.payment_amount = (details && details.payment_amount) || null;
        fields.payment_reference = (details && details.payment_reference) || null;
      } else {
        fields.payment_date = null;
        fields.payment_amount = null;
        fields.payment_reference = null;
      }
      return unwrap(await client.from('documents')
        .update(fields)
        .eq('id', id).select().single());
    },
    async getMonthlySummary() {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      // "Billed" means actual sales — Tax Invoices only, not Quotations/Proforma
      // (those aren't final bills yet).
      const rows = unwrap(await client.from('documents')
        .select('doc_type, subtotal, cgst, sgst, igst, total, customer_snapshot, doc_date, payment_status, due_date')
        .is('deleted_at', null)
        .eq('doc_type', 'tax_invoice')
        .gte('doc_date', monthStart));

      const summary = { subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0, count: rows.length };
      const byCustomer = {};
      rows.forEach(r => {
        summary.subtotal += Number(r.subtotal) || 0;
        summary.cgst += Number(r.cgst) || 0;
        summary.sgst += Number(r.sgst) || 0;
        summary.igst += Number(r.igst) || 0;
        summary.total += Number(r.total) || 0;
        const name = r.customer_snapshot ? r.customer_snapshot.name : 'Unknown';
        byCustomer[name] = (byCustomer[name] || 0) + (Number(r.total) || 0);
      });
      const topCustomers = Object.entries(byCustomer)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ name, total }));

      const today = new Date().toISOString().slice(0, 10);
      const unpaidRows = unwrap(await client.from('documents')
        .select('id, doc_number, total, due_date, customer_snapshot, payment_status, payment_amount')
        .is('deleted_at', null)
        .eq('doc_type', 'tax_invoice')
        .in('payment_status', ['unpaid', 'partial']));
      const outstanding = unpaidRows.map(d => {
        const balance = d.payment_status === 'partial'
          ? Math.max(0, (Number(d.total) || 0) - (Number(d.payment_amount) || 0))
          : Number(d.total) || 0;
        return {
          id: d.id, doc_number: d.doc_number, total: d.total, balance, due_date: d.due_date,
          customer_name: d.customer_snapshot ? d.customer_snapshot.name : null,
          partial: d.payment_status === 'partial',
          overdue: d.due_date ? d.due_date < today : false
        };
      });
      const outstandingTotal = outstanding.reduce((s, d) => s + d.balance, 0);
      const overdueTotal = outstanding.filter(d => d.overdue).reduce((s, d) => s + d.balance, 0);

      // Quotations nearing/past their valid-until date — a nudge to follow up
      // before the customer's interest lapses (no conversion-lineage tracking,
      // so this is just "unconverted-looking" quotations by expiry proximity).
      const followUpCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const quotationRows = unwrap(await client.from('documents')
        .select('id, doc_number, total, valid_until, customer_snapshot')
        .is('deleted_at', null)
        .eq('doc_type', 'quotation')
        .not('valid_until', 'is', null)
        .lte('valid_until', followUpCutoff)
        .order('valid_until'));
      const quotationFollowUps = quotationRows.map(d => ({
        id: d.id, doc_number: d.doc_number, total: d.total, valid_until: d.valid_until,
        customer_name: d.customer_snapshot ? d.customer_snapshot.name : null,
        expired: d.valid_until < today
      }));

      return { ...summary, topCustomers, outstanding, outstandingTotal, overdueTotal, quotationFollowUps };
    }
  };
}

function formatDocNumber(docType, year, seq) {
  return `${PREFIXES[docType]}-${year}-${String(seq).padStart(3, '0')}`;
}

function normalizeSupplier(s) {
  return {
    name: s.name || '', address: s.address || '', city: s.city || '',
    state: s.state || '', pincode: s.pincode || '', mobile: s.mobile || '',
    email: s.email || '', gstin: s.gstin || '', contact_person: s.contact_person || ''
  };
}

function normalizeCustomer(c) {
  return {
    name: c.name || '', address: c.address || '', city: c.city || '',
    state: c.state || '', pincode: c.pincode || '', mobile: c.mobile || '', gstin: c.gstin || '',
    email: c.email || ''
  };
}

function normalizeProduct(p) {
  return {
    description: p.description || '', hsn_sac: p.hsn_sac || '',
    default_rate: Number(p.default_rate) || 0, gst_percent: Number(p.gst_percent) || 0,
    unit: p.unit || 'Nos',
    ...(p.use_structured_specs !== undefined ? {
      use_structured_specs: !!p.use_structured_specs,
      spec_flow_head: p.spec_flow_head || null, spec_model: p.spec_model || null,
      spec_kw_rpm: p.spec_kw_rpm || null, spec_moc: p.spec_moc || null,
      use_engine_spec: !!p.use_engine_spec, spec_engine: p.spec_engine || null,
      use_engine_accessories: !!p.use_engine_accessories, spec_engine_accessories: p.spec_engine_accessories || null,
      use_accessories: !!p.use_accessories, spec_accessories: p.spec_accessories || null
    } : {})
  };
}

module.exports = { createRemoteStore, normalizeSerial, STOCK_OUT_TYPES };
