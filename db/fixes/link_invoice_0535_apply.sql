-- STEP 2 of 2: links the pumps of KOEL invoice 2724611010535 to their catalogue models.
-- Run it ONLY after the check query showed 25, 55 and 9 units with catalogue_model_found = true.
-- It changes the item name and product link of those stock units. Serial numbers, purchase invoices
-- and sales are not touched. Safe to run twice: the second run changes nothing.
-- The last line shows what dealers will now see.

update stock_units u
set product_id = p.id,
    description = p.description,
    updated_at = now()
from (values
  ('VS 5H(L) 1.5 HP 20 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - VSO:5H / VS:5H - 1.1 kW / 1.5 HP - 20 Stage'),
  ('WW 2L(LHH) 1 HP 10 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - WO : 2L / WW : 2L - 0.75 kW / 1 HP - 10 Stage'),
  ('WW 3H(NL) 1.5 HP 15 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - WO:3H(N) / WW:3H(N) - 1.1 kW / 1.5 HP - 15 Stage')
) as m(pattern, catalogue)
join products p on p.description = m.catalogue
where u.product_id is distinct from p.id
  and regexp_replace(u.description, '\s+', ' ', 'g') ilike m.pattern;

select item, quantity from public_stock_list();
