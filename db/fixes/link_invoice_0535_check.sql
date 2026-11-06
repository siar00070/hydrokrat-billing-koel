-- STEP 1 of 2: shows what the fix would change. Nothing is changed by this query.
-- Run it in the Supabase SQL Editor of the KOEL project. You should see three rows:
--   units = how many pumps would be linked: 25, 55 and 9 for invoice 2724611010535
--           (the 9 includes the one pump marked missing, so dealers will still see 8)
--   catalogue_model_found = true on every row
-- If a row says false, stop and tell Claude: that catalogue model is missing from Products.

with map(pattern, catalogue) as (values
  ('VS 5H(L) 1.5 HP 20 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - VSO:5H / VS:5H - 1.1 kW / 1.5 HP - 20 Stage'),
  ('WW 2L(LHH) 1 HP 10 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - WO : 2L / WW : 2L - 0.75 kW / 1 HP - 10 Stage'),
  ('WW 3H(NL) 1.5 HP 15 STAGE%',
   'KOEL Varuna V4 Borewell Submersible Pumpset (100 mm, OF/WF) - WO:3H(N) / WW:3H(N) - 1.1 kW / 1.5 HP - 15 Stage')
)
select m.catalogue,
       count(distinct u.id) as units,
       exists (select 1 from products p where p.description = m.catalogue) as catalogue_model_found
from map m
left join stock_units u
  on u.product_id is null
 and regexp_replace(u.description, '\s+', ' ', 'g') ilike m.pattern
group by m.catalogue
order by m.catalogue;
