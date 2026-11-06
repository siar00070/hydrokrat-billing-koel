-- ---------- Migration: missing stock (billed by the supplier but not physically received) ----------
-- Run once in the Supabase SQL Editor, after migration_stock_qty.sql (also appended to schema.sql). Safe to re-run.
--
-- stock_units.issue_status: null / 'received' = normal; 'missing' = not with us yet; 'replaced' = the supplier
-- sent another unit (replaced_by_serial); 'written_off' = will not come. Only normal units can be sold.
-- stock_lots: short_qty is pending; once it arrives it moves to short_received, or to short_written_off.

alter table stock_units add column if not exists issue_status text;
alter table stock_units add column if not exists issue_note text;
alter table stock_units add column if not exists issue_date date;
alter table stock_units add column if not exists issue_resolved_at timestamptz;
alter table stock_units add column if not exists replaced_by_serial text;
alter table stock_units add column if not exists replaces_serial text;
alter table stock_units drop constraint if exists stock_units_issue_status_check;
alter table stock_units add constraint stock_units_issue_status_check
  check (issue_status is null or issue_status in ('missing', 'received', 'replaced', 'written_off'));

alter table stock_lots add column if not exists short_qty numeric not null default 0;
alter table stock_lots add column if not exists short_received numeric not null default 0;
alter table stock_lots add column if not exists short_written_off numeric not null default 0;
alter table stock_lots add column if not exists short_note text;
alter table stock_lots add column if not exists short_date date;

-- Same as before, plus: a serial that is not physically available cannot go on a document.
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

  select string_agg(u.serial_no || ' (' || replace(u.issue_status, '_', ' ') || ')', ', ') into v_msg
    from stock_units u
    where u.serial_no = any(p_serials) and u.issue_status in ('missing', 'replaced', 'written_off');
  if v_msg is not null then
    return 'Not available: ' || v_msg;
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
