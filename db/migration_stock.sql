-- ---------- Migration: Stock (purchase invoices in, serial-numbered units out via TI / DC) ----------
-- Run once in the Supabase SQL Editor (also appended to schema.sql). Safe to re-run.
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
