const PREFIXES = { quotation: 'QT-HVK', proforma: 'PI-HVK', tax_invoice: 'TI-HVK', delivery_challan: 'DC-HVK', purchase_order: 'PO-HVK', techno_commercial: 'TCO-HVK' };

function createRemoteStore(client) {
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
    const { data } = await client.from('counters').select('last_seq').eq('doc_type', docType).eq('year', year).maybeSingle();
    if (data && data.last_seq === seq) {
      await client.from('counters').update({ last_seq: seq - 1 }).eq('doc_type', docType).eq('year', year);
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
      const { data } = await client.from('counters').select('last_seq').eq('doc_type', docType).eq('year', year).maybeSingle();
      const seq = (data ? data.last_seq : 0) + 1;
      return formatDocNumber(docType, year, seq);
    },
    async nextDocNumber(docType, year) {
      const { data, error } = await client.rpc('next_doc_number', { p_doc_type: docType, p_year: year });
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
      return true;
    },
    async restoreDocument(id) {
      const uid = await currentUserId();
      const doc = unwrap(await client.from('documents').select('doc_number').eq('id', id).single());
      const clashes = unwrap(await client.from('documents')
        .select('id').eq('doc_number', doc.doc_number).is('deleted_at', null).neq('id', id));
      if (clashes.length > 0) {
        throw new Error(`Cannot restore — ${doc.doc_number} has already been reused by a newer document. Use "Duplicate As" to recreate this one under a new number instead.`);
      }
      unwrap(await client.from('documents')
        .update({ deleted_at: null, updated_by: uid })
        .eq('id', id));
      return true;
    },
    async purgeDocument(id) {
      unwrap(await client.from('documents').delete().eq('id', id));
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

module.exports = { createRemoteStore };
