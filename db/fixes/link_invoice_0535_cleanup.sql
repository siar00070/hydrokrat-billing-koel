-- OPTIONAL, after the fix has worked: removes the three extra products that carry the supplier's
-- wording, so they no longer clutter Products or the item lists. Nothing is lost:
--   * it only deletes a product that no stock unit or stock lot points to any more;
--   * quotation, order and invoice lines keep their text, they just lose the link to that product.
-- The result shows how many such products are left (0 means all removed).

delete from products p
where regexp_replace(p.description, '\s+', ' ', 'g') ilike any (array[
        'VS 5H(L) 1.5 HP 20 STAGE SP WF%',
        'WW 2L(LHH) 1 HP 10 STAGE SP WF%',
        'WW 3H(NL) 1.5 HP 15 STAGE SP WF%'])
  and p.description not like 'KOEL Varuna%'
  and not exists (select 1 from stock_units u where u.product_id = p.id)
  and not exists (select 1 from stock_lots l where l.product_id = p.id);

select count(*) as supplier_wording_products_left
from products
where regexp_replace(description, '\s+', ' ', 'g') ilike any (array[
        'VS 5H(L) 1.5 HP 20 STAGE SP WF%',
        'WW 2L(LHH) 1 HP 10 STAGE SP WF%',
        'WW 3H(NL) 1.5 HP 15 STAGE SP WF%']);
