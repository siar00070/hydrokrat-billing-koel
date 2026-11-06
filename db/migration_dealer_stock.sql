-- ---------- Migration: public stock list for dealers ----------
-- Run once in the Supabase SQL Editor, after migration_stock_missing.sql (also appended to schema.sql). Safe to re-run.
--
-- The dealer page has no login, so it may call only this function. It runs with the owner's rights and
-- returns item name and quantity, and nothing else: no serials, rates, invoices, suppliers or dealers.

create or replace function public_stock_list()
returns table (item text, quantity numeric)
language sql
stable
security definer
set search_path = public
as $$
  with on_hand as (
    -- Serial-numbered units on the shelf
    select u.product_id, u.description, count(*)::numeric as qty
    from stock_units u
    where u.out_document_id is null and (u.issue_status is null or u.issue_status = 'received')
    group by u.product_id, u.description
    union all
    -- Quantity-only items that arrived
    select l.product_id, l.description, sum(l.qty - l.short_qty - l.short_written_off)
    from stock_lots l
    group by l.product_id, l.description
    union all
    -- Quantity-only items sold or delivered
    select o.product_id, null, -sum(o.qty)
    from stock_qty_out o
    where exists (select 1 from stock_lots l where l.product_id = o.product_id)
    group by o.product_id
  )
  select split_part(coalesce(p.description, max(h.description)), E'\n', 1) as item, sum(h.qty) as quantity
  from on_hand h
  left join products p on p.id = h.product_id
  group by h.product_id, p.description, case when h.product_id is null then h.description end
  having sum(h.qty) > 0
  order by 1;
$$;
revoke all on function public_stock_list() from public;
grant execute on function public_stock_list() to anon, authenticated;
