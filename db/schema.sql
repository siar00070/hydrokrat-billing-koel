-- HV Billing — Supabase schema
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run: uses "if not exists" / "or replace" everywhere.

-- ---------- Tables ----------

create table if not exists company_settings (
  id int primary key check (id = 1),
  name text, address_line1 text, address_line2 text, address_line3 text,
  city_state_pincode text, phone1 text, phone2 text, email text,
  gstin text, state text,
  bank_name text, account_name text, account_no text, ifsc text,
  quotation_terms text, proforma_terms text, tax_invoice_terms text,
  default_notes text, default_gst_percent numeric default 18,
  updated_at timestamptz default now(),
  updated_by uuid
);

create table if not exists customers (
  id bigint generated always as identity primary key,
  name text not null,
  address text, city text, state text, pincode text, mobile text, gstin text,
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now(),
  updated_by uuid
);

create table if not exists products (
  id bigint generated always as identity primary key,
  description text not null,
  hsn_sac text,
  default_rate numeric default 0,
  gst_percent numeric default 18,
  unit text default 'Nos',
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now(),
  updated_by uuid
);

create table if not exists documents (
  id bigint generated always as identity primary key,
  doc_type text not null check (doc_type in ('quotation', 'proforma', 'tax_invoice')),
  doc_number text not null,
  doc_date date not null,
  valid_until date,
  customer_id bigint references customers(id) on delete set null,
  customer_snapshot jsonb,
  place_of_supply text,
  subtotal numeric default 0,
  discount numeric default 0,
  cgst numeric default 0,
  sgst numeric default 0,
  igst numeric default 0,
  round_off numeric default 0,
  total numeric default 0,
  terms text,
  notes text,
  status text default 'saved',
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now(),
  updated_by uuid
);
create unique index if not exists documents_doc_type_number_uk on documents(doc_type, doc_number);

create table if not exists document_items (
  id bigint generated always as identity primary key,
  document_id bigint not null references documents(id) on delete cascade,
  product_id bigint references products(id) on delete set null,
  description text,
  hsn_sac text,
  qty numeric default 1,
  rate numeric default 0,
  gst_percent numeric default 18,
  amount numeric default 0,
  sort_order int default 0
);

create table if not exists counters (
  doc_type text not null,
  year int not null,
  last_seq int not null default 0,
  primary key (doc_type, year)
);

-- ---------- Atomic global numbering ----------
-- Concurrent calls from different branches are serialized by Postgres itself,
-- so two branches can never receive the same sequence number, and numbers are
-- handed out strictly in the order requests actually reach the database.
create or replace function next_doc_number(p_doc_type text, p_year int)
returns int
language sql
as $$
  insert into counters (doc_type, year, last_seq)
  values (p_doc_type, p_year, 1)
  on conflict (doc_type, year)
  do update set last_seq = counters.last_seq + 1
  returning last_seq;
$$;

-- ---------- Seed company settings (safe to re-run) ----------
insert into company_settings (
  id, name, address_line1, address_line2, address_line3, city_state_pincode,
  phone1, phone2, email, gstin, state,
  bank_name, account_name, account_no, ifsc,
  quotation_terms, proforma_terms, tax_invoice_terms, default_notes, default_gst_percent
) values (
  1, 'Hydrokrat Ventures', 'Old No.8/99, New No.185/610', '"A" Block, 6th Floor, Shivalaya Apartment,', 'Ethiraj Salai, Egmore,', 'Chennai - 600 008.',
  '+91 97900 25599', '+91 73388 25599', 'hydrokratpumps@gmail.com', '33AEDPIO763H1ZV', 'Tamil Nadu',
  'City Union Bank', 'Hydrokrat Ventures', '510909010408230', 'CIUB0000129',
  E'1. This quotation is valid until the date mentioned above.\n2. Goods/services will be supplied after order confirmation.\n3. Freight at actuals.\n4. Taxes are calculated as applicable at the time of billing.',
  E'1. This proforma invoice is valid until the date mentioned above.\n2. Goods/services will be supplied after payment confirmation.\n3. Freight at actuals.\n4. Taxes are calculated as applicable at the time of billing.',
  E'1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged on overdue bills.\n3. Freight at actuals.\n4. Subject to Chennai jurisdiction only.',
  'Thank you for choosing Hydrokrat Ventures.', 18
) on conflict (id) do nothing;

-- ---------- Row Level Security ----------
-- Any authenticated (logged-in) user can read/write everything — matches
-- "all branch PCs can view, edit, and download every document".
alter table company_settings enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table documents enable row level security;
alter table document_items enable row level security;
alter table counters enable row level security;

drop policy if exists "authenticated full access" on company_settings;
create policy "authenticated full access" on company_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on customers;
create policy "authenticated full access" on customers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on products;
create policy "authenticated full access" on products for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on documents;
create policy "authenticated full access" on documents for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on document_items;
create policy "authenticated full access" on document_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on counters;
create policy "authenticated full access" on counters for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Let any authenticated user call the numbering function.
grant execute on function next_doc_number(text, int) to authenticated;

-- ---------- Migration: payment status, soft-delete, branch tagging ----------
-- Safe to re-run.
alter table documents add column if not exists payment_status text default 'unpaid';
alter table documents add column if not exists due_date date;
alter table documents add column if not exists deleted_at timestamptz;
alter table documents add column if not exists branch_name text;
alter table documents add column if not exists payment_date date;
alter table documents add column if not exists payment_amount numeric;
alter table documents add column if not exists payment_reference text;

-- ---------- Storage bucket for app auto-updates ----------
insert into storage.buckets (id, name, public)
values ('app-updates', 'app-updates', true)
on conflict (id) do update set public = true;

drop policy if exists "public read app-updates" on storage.objects;
create policy "public read app-updates" on storage.objects for select
  using (bucket_id = 'app-updates');

drop policy if exists "authenticated write app-updates" on storage.objects;
create policy "authenticated write app-updates" on storage.objects for all
  using (bucket_id = 'app-updates' and auth.role() = 'authenticated')
  with check (bucket_id = 'app-updates' and auth.role() = 'authenticated');

-- ---------- Migration: Delivery Challan, signature, customer email ----------
-- Safe to re-run.
alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check
  check (doc_type in ('quotation', 'proforma', 'tax_invoice', 'delivery_challan'));

alter table documents add column if not exists vehicle_no text;
alter table documents add column if not exists transporter_name text;
alter table documents add column if not exists driver_name text;
alter table documents add column if not exists driver_contact text;
alter table documents add column if not exists place_of_delivery text;
alter table documents add column if not exists transport_reason text;

alter table company_settings add column if not exists signature_data_uri text;
alter table customers add column if not exists email text;
alter table company_settings add column if not exists delete_password_hash text;
alter table company_settings add column if not exists signature_enabled boolean default true;
alter table documents add column if not exists include_signature boolean default true;
alter table company_settings add column if not exists stamp_data_uri text;
alter table company_settings add column if not exists stamp_enabled boolean default true;
alter table documents add column if not exists include_stamp boolean default true;

-- ---------- Migration: Ship To address (per-document, defaults to Bill To) ----------
alter table documents add column if not exists ship_to_same boolean default true;
alter table documents add column if not exists ship_to_name text;
alter table documents add column if not exists ship_to_address text;
alter table documents add column if not exists ship_to_city text;
alter table documents add column if not exists ship_to_state text;
alter table documents add column if not exists ship_to_pincode text;

-- ---------- Migration: Project Name / Enquiry No (quotation, proforma) ----------
alter table documents add column if not exists project_name text;
alter table documents add column if not exists enquiry_no text;

-- ---------- Migration: Purchase Order (HV -> Supplier) ----------
create table if not exists suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  address text, city text, state text, pincode text, mobile text, email text, gstin text,
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now(),
  updated_by uuid
);
alter table suppliers enable row level security;
drop policy if exists "authenticated full access" on suppliers;
create policy "authenticated full access" on suppliers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check
  check (doc_type in ('quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'purchase_order'));

alter table documents add column if not exists supplier_id bigint references suppliers(id) on delete set null;
alter table documents add column if not exists supplier_snapshot jsonb;
alter table documents add column if not exists deliver_to_same boolean default true;
alter table documents add column if not exists deliver_to_name text;
alter table documents add column if not exists deliver_to_address text;
alter table documents add column if not exists deliver_to_city text;
alter table documents add column if not exists deliver_to_state text;
alter table documents add column if not exists deliver_to_pincode text;
alter table company_settings add column if not exists purchase_order_terms text;

-- ---------- Migration: fixed pump spec fields per item (optional, toggle per item) ----------
alter table document_items add column if not exists use_structured_specs boolean default false;
alter table document_items add column if not exists spec_flow_head text;
alter table document_items add column if not exists spec_model text;
alter table document_items add column if not exists spec_kw_rpm text;
alter table document_items add column if not exists spec_moc text;

-- ---------- Migration: engine spec / engine accessories per item (diesel-engine driven pumps, independent toggles) ----------
alter table document_items add column if not exists use_engine_spec boolean default false;
alter table document_items add column if not exists spec_engine text;
alter table document_items add column if not exists use_engine_accessories boolean default false;
alter table document_items add column if not exists spec_engine_accessories text;
alter table document_items add column if not exists use_accessories boolean default false;
alter table document_items add column if not exists spec_accessories text;

-- Internal rate calculator per item (never printed): LP, discount %, freight, margin %
alter table document_items add column if not exists use_pricing_calc boolean default false;
alter table document_items add column if not exists item_lp numeric;
alter table document_items add column if not exists item_discount_pct numeric;
alter table document_items add column if not exists item_freight numeric;
alter table document_items add column if not exists item_margin_pct numeric;
alter table document_items add column if not exists item_acc_lp numeric;
alter table document_items add column if not exists item_acc_discount_pct numeric;
alter table document_items add column if not exists item_eng_acc_lp numeric;
alter table document_items add column if not exists item_eng_acc_discount_pct numeric;

-- ---------- Migration: Revised Offer toggle (quotation, proforma) ----------
alter table documents add column if not exists is_revised boolean default false;
alter table documents add column if not exists revision_no int default 0;

-- ---------- Migration: Purchase Order commercial terms + delivery info ----------
alter table documents add column if not exists price_basis text;
alter table documents add column if not exists payment_terms text;
alter table documents add column if not exists packing_terms text;
alter table documents add column if not exists freight_terms text;
alter table documents add column if not exists warranty_terms text;
alter table documents add column if not exists scope_of_supply text;
alter table documents add column if not exists delivery_schedule text;
alter table documents add column if not exists delivery_type text;
alter table documents add column if not exists transportation text;

-- ---------- Migration: Supplier contact person ----------
alter table suppliers add column if not exists contact_person text;

-- Separate toggle for the accessories price calculator
alter table document_items add column if not exists use_acc_pricing_calc boolean default false;

-- Ready sale price add-on (added to the calculated rate as is)
alter table document_items add column if not exists item_fixed_price numeric;

-- Products can carry pump specs so picking one fills the spec fields
alter table products add column if not exists use_structured_specs boolean default false;
alter table products add column if not exists spec_flow_head text;
alter table products add column if not exists spec_model text;
alter table products add column if not exists spec_kw_rpm text;
alter table products add column if not exists spec_moc text;
alter table products add column if not exists use_engine_spec boolean default false;
alter table products add column if not exists spec_engine text;
alter table products add column if not exists use_engine_accessories boolean default false;
alter table products add column if not exists spec_engine_accessories text;
alter table products add column if not exists use_accessories boolean default false;
alter table products add column if not exists spec_accessories text;

-- ---------- Migration: Techno Commercial Offer (TCO-HV) ----------
alter table documents drop constraint if exists documents_doc_type_check;
alter table documents add constraint documents_doc_type_check
  check (doc_type in ('quotation', 'proforma', 'tax_invoice', 'delivery_challan', 'purchase_order', 'techno_commercial'));
alter table company_settings add column if not exists techno_commercial_terms text;
update company_settings set techno_commercial_terms = quotation_terms where id = 1 and techno_commercial_terms is null;

-- ---------- Migration: Stock (purchase invoices in, serial-numbered units out via TI / DC) ----------
--
-- Every unit received on a supplier's purchase invoice is one stock_units row with its serial number.
-- A unit is in stock while out_document_id is null; a saved Tax Invoice or Delivery Challan that lists
-- the serial takes it out (out_document_id = that document). Serials are stored trimmed + upper-case.

create table if not exists purchase_invoices (
  id bigint generated always as identity primary key,
  supplier_id bigint references suppliers(id) on delete set null,
  supplier_snapshot jsonb,
  po_document_id bigint references documents(id) on delete set null,
  po_number text,
  invoice_no text not null,
  invoice_date date not null,
  notes text,
  created_at timestamptz default now(),
  created_by uuid
);

create table if not exists stock_units (
  id bigint generated always as identity primary key,
  purchase_invoice_id bigint not null references purchase_invoices(id) on delete cascade,
  product_id bigint references products(id) on delete set null,
  description text not null,
  hsn_sac text,
  serial_no text not null,
  purchase_rate numeric default 0,
  out_document_id bigint references documents(id) on delete set null,
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now()
);
create unique index if not exists stock_units_serial_uk on stock_units (serial_no);
create index if not exists stock_units_out_doc_idx on stock_units (out_document_id);
create index if not exists stock_units_invoice_idx on stock_units (purchase_invoice_id);

-- Serial numbers chosen for a Tax Invoice / Delivery Challan line (printed on the document).
alter table document_items add column if not exists serial_nos text[];

alter table purchase_invoices enable row level security;
alter table stock_units enable row level security;
drop policy if exists "authenticated full access" on purchase_invoices;
create policy "authenticated full access" on purchase_invoices for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on stock_units;
create policy "authenticated full access" on stock_units for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Point the serials of one document at that document, atomically.
--   p_doc_id    the TI / DC (null only for a dry run of a not-yet-saved document)
--   p_doc_type  'tax_invoice' or 'delivery_challan'
--   p_serials   every serial on the document (trimmed, upper-case); '{}' releases them all
--   p_dry_run   true = only check, change nothing
-- Returns null on success, otherwise a message naming the serials that cannot be used.
-- A Tax Invoice may take serials already sent on a Delivery Challan (the invoice for that delivery);
-- the unit then belongs to the invoice. A Delivery Challan may keep listing serials its invoice now holds.
-- Serials dropped from a document go back to a live Delivery Challan that still lists them, else to stock.
create or replace function sync_document_stock(p_doc_id bigint, p_doc_type text, p_serials text[], p_dry_run boolean)
returns text
language plpgsql
as $$
declare
  v_msg text;
begin
  p_serials := coalesce(p_serials, '{}');

  perform 1 from stock_units
    where serial_no = any(p_serials) or (p_doc_id is not null and out_document_id = p_doc_id)
    for update;

  select string_agg(s, ', ') into v_msg
    from (select distinct s from unnest(p_serials) s) x
    where not exists (select 1 from stock_units u where u.serial_no = x.s);
  if v_msg is not null then
    return 'Not in stock: ' || v_msg;
  end if;

  select string_agg(u.serial_no || ' (' || d.doc_number || ')', ', ') into v_msg
    from stock_units u join documents d on d.id = u.out_document_id
    where u.serial_no = any(p_serials)
      and u.out_document_id is distinct from p_doc_id
      and not (p_doc_type = 'tax_invoice' and d.doc_type = 'delivery_challan')
      and not (p_doc_type = 'delivery_challan' and d.doc_type = 'tax_invoice');
  if v_msg is not null then
    return 'Already used on another document: ' || v_msg;
  end if;

  if p_dry_run or p_doc_id is null then
    return null;
  end if;

  update stock_units u set
    out_document_id = (
      select d.id from documents d join document_items i on i.document_id = d.id
      where d.doc_type = 'delivery_challan' and d.deleted_at is null and d.id <> p_doc_id
        and u.serial_no = any(i.serial_nos)
      order by d.id limit 1),
    updated_at = now()
  where u.out_document_id = p_doc_id and not (u.serial_no = any(p_serials));

  update stock_units set out_document_id = p_doc_id, updated_at = now()
  where serial_no = any(p_serials)
    and (out_document_id is null or p_doc_type = 'tax_invoice');

  return null;
end;
$$;
grant execute on function sync_document_stock(bigint, text, text[], boolean) to authenticated;
