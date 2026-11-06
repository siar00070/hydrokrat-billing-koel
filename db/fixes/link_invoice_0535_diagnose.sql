-- DIAGNOSE: shows how the pumps of invoice 0535 are stored. Nothing is changed by this query.
-- Run it in the Supabase SQL Editor of the KOEL project and send the result (a screenshot is fine).
--   serial units   = pumps stocked with serial numbers
--   quantity lots  = pumps stocked by quantity only
--   product record = products whose name is the supplier's wording
-- product_name empty = the pumps are not linked to any product.

select 'serial units' as kind, u.product_id, p.description as product_name,
       regexp_replace(u.description, '\s+', ' ', 'g') as stock_name,
       u.issue_status as status, count(*)::numeric as qty
from stock_units u
left join products p on p.id = u.product_id
where u.purchase_invoice_id in (select id from purchase_invoices where invoice_no like '%0535')
group by u.product_id, p.description, u.description, u.issue_status

union all

select 'quantity lots', l.product_id, p.description,
       regexp_replace(l.description, '\s+', ' ', 'g'),
       case when l.short_qty > 0 then l.short_qty::text || ' short' end, l.qty
from stock_lots l
left join products p on p.id = l.product_id
where l.purchase_invoice_id in (select id from purchase_invoices where invoice_no like '%0535')

union all

select 'product record', p.id, p.description, null, null, null
from products p
where regexp_replace(p.description, '\s+', ' ', 'g') ilike '%STAGE SP WF%'

order by 1, 4;
