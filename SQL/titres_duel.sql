-- =====================================================================
--  Deux nouveaux titres de profil en boutique :
--    - Titre « Le Collectionneur »
--    - Titre « L’Invaincu »
--  Mêmes réglages que le Titre « Maître du d20 » (prix, boutique, description,
--  forme du texte) : ils sont recopiés depuis lui, pour rester identiques.
--
--  À exécuter une fois dans Supabase > SQL Editor. Relançable sans doublon.
-- =====================================================================
insert into public.items (name, description, price, shop, kind, payload, min_stock, max_stock, is_available)
select replace(d20.name, 'Maître du d20', nouveau.texte),
       d20.description, d20.price, d20.shop, d20.kind,
       jsonb_set(d20.payload::jsonb, '{text}', to_jsonb(replace(d20.payload->>'text', 'Maître du d20', nouveau.texte))),
       d20.min_stock, d20.max_stock, true
from public.items d20
cross join (values ('Le Collectionneur'), ('L’Invaincu')) as nouveau(texte)
where d20.kind = 'title'
  and d20.name like '%Maître du d20%'
  and not exists (
    select 1 from public.items i
    where i.kind = 'title' and i.name = replace(d20.name, 'Maître du d20', nouveau.texte)
  );

-- Vérification : les titres en boutique
select id, name, price, shop, payload->>'text' as texte, is_available
from public.items where kind = 'title' order by id;
