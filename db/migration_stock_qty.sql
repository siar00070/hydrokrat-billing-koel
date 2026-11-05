-- ---------- Migration: quantity-only stock (items without serial numbers, e.g. control panels) ----------
-- Run once in the Supabase SQL Editor, after migration_stock.sql (also appended to schema.sql). Safe to re-run.
--
-- stock_lots holds what came in on a purchase invoice; stock_qty_out holds what each live Tax Invoice /
-- Delivery Challan took out. Balance per product = sum(lots) - sum(out).

create table if not exists stock_lots (
  id bigint generated always as identity primary key,
  purchase_invoice_id bigint not null references purchase_invoices(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  description text not null,
  hsn_sac text,
  qty numeric not null,
  purchase_rate numeric default 0,
  created_at timestamptz default now(),
  created_by uuid
);
create index if not exists stock_lots_product_idx on stock_lots (product_id);
create index if not exists stock_lots_invoice_idx on stock_lots (purchase_invoice_id);

create table if not exists stock_qty_out (
  document_id bigint not null references documents(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  qty numeric not null,
  primary key (document_id, product_id)
);
create index if not exists stock_qty_out_product_idx on stock_qty_out (product_id);

-- The Delivery Challan a Tax Invoice was converted from, so the same goods are not counted out twice.
alter table documents add column if not exists source_dc_id bigint references documents(id) on delete set null;

alter table stock_lots enable row level security;
alter table stock_qty_out enable row level security;
drop policy if exists "authenticated full access" on stock_lots;
create policy "authenticated full access" on stock_lots for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on stock_qty_out;
create policy "authenticated full access" on stock_qty_out for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- The product a document line refers to: its product_id, else a product with the same title.
create or replace function stock_item_product(p_product_id bigint, p_description text)
returns bigint
language sql
stable
as $$
  select coalesce(p_product_id, (
    select p.id from products p
    where lower(trim(split_part(p.description, E'\n', 1))) = lower(trim(split_part(p_description, E'\n', 1)))
    order by p.id limit 1));
$$;
grant execute on function stock_item_product(bigint, text) to authenticated;

-- Recalculate what one document takes out: its lines without serial numbers, nothing if it is deleted.
-- A Delivery Challan only counts what its live Tax Invoices have not already taken.
create or replace function sync_document_qty(p_doc_id bigint)
returns void
language plpgsql
as $$
declare
  v_doc documents%rowtype;
begin
  select * into v_doc from documents where id = p_doc_id;
  if not found then
    return;
  end if;

  delete from stock_qty_out where document_id = p_doc_id;

  if v_doc.deleted_at is null and v_doc.doc_type in ('tax_invoice', 'delivery_challan') then
    insert into stock_qty_out (document_id, product_id, qty)
    select p_doc_id, n.pid, n.q - coalesce(inv.q, 0)
    from (
      select stock_item_product(i.product_id, i.description) pid, sum(i.qty) q
      from document_items i
      where i.document_id = p_doc_id and coalesce(cardinality(i.serial_nos), 0) = 0
      group by 1
    ) n
    left join lateral (
      select sum(ti.qty) q
      from document_items ti join documents t on t.id = ti.document_id
      where v_doc.doc_type = 'delivery_challan' and t.source_dc_id = p_doc_id
        and t.doc_type = 'tax_invoice' and t.deleted_at is null
        and coalesce(cardinality(ti.serial_nos), 0) = 0
        and stock_item_product(ti.product_id, ti.description) = n.pid
    ) inv on true
    where n.pid is not null and n.q - coalesce(inv.q, 0) > 0;
  end if;

  if v_doc.source_dc_id is not null then
    perform sync_document_qty(v_doc.source_dc_id);
  end if;
end;
$$;
grant execute on function sync_document_qty(bigint) to authenticated;
