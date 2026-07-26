-- DATA SEED: four fictional public-demo restaurants.
-- Data-only, idempotent for the four stable restaurant UUIDs.

begin;

do $$
begin
  if exists (
    select 1 from public.restaurants
    where id in (
      'acced74f-ddac-43a0-9f78-016c397f4b8e',
      '6cce66fb-4d2d-402f-abe5-22e9784d559c',
      'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
      '72c76694-f533-46b8-b831-1965210a0cb4'
    )
    and name not in ('Silesiana Italiana', 'Ruszt i Ogień', 'Syto po Naszymu', 'Kebs & Roll')
  ) then
    raise exception 'Refusing demo seed: one of the stable UUIDs belongs to another restaurant';
  end if;
end $$;

insert into public.restaurants (
  id, name, address, city, cuisine_type, rating, image_url,
  lat, lng, partner_mode, menu_count, is_active, is_open,
  min_order_pln, delivery_available, price_level,
  taxonomy_groups, taxonomy_cats, taxonomy_tags, taxonomy_vibes, taxonomy_dietarys
)
values
('acced74f-ddac-43a0-9f78-016c397f4b8e', 'Silesiana Italiana', 'Piekary Śląskie · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane', 'Piekary Śląskie', 'Włoska / Śląska fusion', 4.8, null, 50.389, 18.951, false, 17, false, true, 25, true, 3, array['italian','polish'], array['pizza','makaron','fusion'], array['delivery','vege'], array['date_night','modern'], array['vegetarian']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c', 'Ruszt i Ogień', 'Piekary Śląskie · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane', 'Piekary Śląskie', 'Grill / Steakhouse', 4.7, null, 50.386, 18.944, false, 17, false, true, 30, true, 3, array['american','polish'], array['grill','stek','miesne'], array['delivery','spicy'], array['casual','open_fire'], array['vegetarian']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60', 'Syto po Naszymu', 'Piekary Śląskie · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane', 'Piekary Śląskie', 'Polska domowa', 4.6, null, 50.391, 18.947, false, 18, false, true, 20, true, 2, array['polish'], array['obiady','zupy','pierogi'], array['delivery','family'], array['family','comfort_food'], array['vegetarian']),
('72c76694-f533-46b8-b831-1965210a0cb4', 'Kebs & Roll', 'Piekary Śląskie · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane', 'Piekary Śląskie', 'Kebab / Street food', 4.7, null, 50.384, 18.950, false, 22, false, true, 20, true, 2, array['middle_eastern','street_food'], array['kebab','rollo','falafel'], array['delivery','spicy','vege'], array['street_food','quick'], array['vegetarian','vegan'])
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  city = excluded.city,
  cuisine_type = excluded.cuisine_type,
  rating = excluded.rating,
  image_url = null,
  lat = excluded.lat,
  lng = excluded.lng,
  owner_id = null,
  owner_email = null,
  business_id = null,
  partner_mode = false,
  menu_count = excluded.menu_count,
  is_active = false,
  is_open = true,
  min_order_pln = excluded.min_order_pln,
  delivery_available = true,
  price_level = excluded.price_level,
  taxonomy_groups = excluded.taxonomy_groups,
  taxonomy_cats = excluded.taxonomy_cats,
  taxonomy_tags = excluded.taxonomy_tags,
  taxonomy_vibes = excluded.taxonomy_vibes,
  taxonomy_dietarys = excluded.taxonomy_dietarys,
  phone = null,
  website = null,
  maps_rating = null,
  maps_place_id = null,
  maps_url = null,
  maps_ratings_total = null,
  photo_gallery = null,
  updated_at = now();

delete from public.menu_items_v2
where restaurant_id in (
  'acced74f-ddac-43a0-9f78-016c397f4b8e',
  '6cce66fb-4d2d-402f-abe5-22e9784d559c',
  'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
  '72c76694-f533-46b8-b831-1965210a0cb4'
);

with items (
  restaurant_id, name, description, category, base_type, meat_type,
  size_or_variant, price_pln, spicy, is_vege, base_name, variant_name,
  variant_type, item_family, item_aliases, item_tags, dietary_flags,
  popularity_score, section_order, ingredients, allergens
) as (values
-- Silesiana Italiana: 17 rows / 14 families
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Focaccia z masłem ziołowym','Focaccia na zakwasie, masło czosnkowo-ziołowe i sól wędzona.','Na początek','starter',null,null,18,false,true,'Focaccia z masłem ziołowym',null,null,'focaccia',array['focaccia','pieczywo czosnkowe'],array['wloska','vege'],array['vegetarian'],82,10,array['mąka pszenna','masło','czosnek','zioła'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Arancini z krupniokiem','Chrupiące kulki ryżowe z krupniokiem, parmezanem i sosem pomidorowym.','Na początek','starter','pork',null,27,false,false,'Arancini z krupniokiem',null,null,'arancini_krupniok',array['arancini','kulki ryzowe','krupniok'],array['fusion','miesne'],array[]::text[],88,10,array['ryż','krupniok','parmezan','pomidor','bułka tarta'],array['gluten','mleko','jaja']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Silesiana 32 cm','Pomidor, mozzarella, boczek, cebula, pieczarki i majeranek.','Pizza','pizza','pork','32 cm',35,false,false,'Pizza Silesiana','32 cm','size','pizza_silesiana',array['pizza slaska','pizza z boczkiem'],array['pizza','miesne'],array[]::text[],95,20,array['mąka pszenna','pomidor','mozzarella','boczek','cebula','pieczarki'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Silesiana 40 cm','Pomidor, mozzarella, boczek, cebula, pieczarki i majeranek.','Pizza','pizza','pork','40 cm',46,false,false,'Pizza Silesiana','40 cm','size','pizza_silesiana',array['pizza slaska','pizza z boczkiem'],array['pizza','miesne'],array[]::text[],90,20,array['mąka pszenna','pomidor','mozzarella','boczek','cebula','pieczarki'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Margherita 32 cm','Pomidor San Marzano, mozzarella, bazylia i oliwa.','Pizza','pizza',null,'32 cm',29,false,true,'Pizza Margherita','32 cm','size','pizza_margherita',array['margherita','pizza serowa'],array['pizza','vege'],array['vegetarian'],91,20,array['mąka pszenna','pomidor','mozzarella','bazylia'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Margherita 40 cm','Pomidor San Marzano, mozzarella, bazylia i oliwa.','Pizza','pizza',null,'40 cm',39,false,true,'Pizza Margherita','40 cm','size','pizza_margherita',array['margherita','pizza serowa'],array['pizza','vege'],array['vegetarian'],86,20,array['mąka pszenna','pomidor','mozzarella','bazylia'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Bianca z gruszką 32 cm','Mozzarella, gruszka, gorgonzola, orzech włoski i rukola.','Pizza','pizza',null,'32 cm',36,false,true,'Pizza Bianca z gruszką','32 cm','size','pizza_bianca_gruszka',array['pizza bianca','pizza z gruszka'],array['pizza','vege'],array['vegetarian'],84,20,array['mąka pszenna','mozzarella','gruszka','gorgonzola','orzech włoski','rukola'],array['gluten','mleko','orzechy']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Pizza Bianca z gruszką 40 cm','Mozzarella, gruszka, gorgonzola, orzech włoski i rukola.','Pizza','pizza',null,'40 cm',48,false,true,'Pizza Bianca z gruszką','40 cm','size','pizza_bianca_gruszka',array['pizza bianca','pizza z gruszka'],array['pizza','vege'],array['vegetarian'],79,20,array['mąka pszenna','mozzarella','gruszka','gorgonzola','orzech włoski','rukola'],array['gluten','mleko','orzechy']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Tagliatelle z wołowiną i grzybami','Makaron jajeczny, długo duszona wołowina, leśne grzyby i parmezan.','Makarony','pasta','beef',null,44,false,false,'Tagliatelle z wołowiną i grzybami',null,null,'tagliatelle_wolowina',array['makaron z wolowina','makaron z grzybami'],array['makaron','miesne'],array[]::text[],93,30,array['makaron jajeczny','wołowina','grzyby leśne','parmezan'],array['gluten','jaja','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Gnocchi z wędzonym serem','Gnocchi ziemniaczane, krem z wędzonego sera, szpinak i prażone pestki.','Makarony','pasta',null,null,38,false,true,'Gnocchi z wędzonym serem',null,null,'gnocchi_ser',array['gnocchi','kluski z serem','makaron ze szpinakiem'],array['makaron','vege'],array['vegetarian'],87,30,array['ziemniaki','mąka pszenna','wędzony ser','szpinak','pestki dyni'],array['gluten','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Ravioli z dynią','Ravioli z pieczoną dynią, masłem szałwiowym i pestkami.','Makarony','pasta',null,null,39,false,true,'Ravioli z dynią',null,null,'ravioli_dynia',array['ravioli','makaron z dynia'],array['makaron','vege'],array['vegetarian'],80,30,array['mąka pszenna','jaja','dynia','masło','szałwia','pestki dyni'],array['gluten','jaja','mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Lasagne wołowe','Warstwy makaronu, ragù wołowe, beszamel, pomidor i parmezan.','Makarony','pasta','beef',null,42,false,false,'Lasagne wołowe',null,null,'lasagne_wolowe',array['lasagne','lazania','makaron z wolowina'],array['makaron','miesne'],array[]::text[],94,30,array['makaron','wołowina','pomidor','mleko','masło','parmezan'],array['gluten','mleko','jaja']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Insalata z pieczonym burakiem','Rukola, pieczony burak, kozi ser, pomarańcza i pestki dyni.','Sałaty','salad',null,null,31,false,true,'Insalata z pieczonym burakiem',null,null,'insalata_burak',array['salatka z burakiem','salatka z kozim serem'],array['salatka','vege'],array['vegetarian','gluten_free'],76,40,array['rukola','burak','kozi ser','pomarańcza','pestki dyni'],array['mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Tiramisu kawowe','Krem mascarpone, biszkopty, espresso i kakao.','Desery','dessert',null,null,22,false,true,'Tiramisu kawowe',null,null,'tiramisu',array['tiramisu','deser kawowy'],array['deser','vege'],array['vegetarian'],90,50,array['mascarpone','biszkopty','espresso','kakao','jaja'],array['gluten','mleko','jaja']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Panna cotta makowa','Waniliowa panna cotta z makiem i sosem wiśniowym.','Desery','dessert',null,null,21,false,true,'Panna cotta makowa',null,null,'panna_cotta_mak',array['panna cotta','deser z makiem'],array['deser','vege'],array['vegetarian','gluten_free'],78,50,array['śmietanka','wanilia','mak','wiśnie','żelatyna'],array['mleko']),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Lemoniada czerwona pomarańcza 0,3 l','Domowa lemoniada z czerwonej pomarańczy i rozmarynu.','Napoje','drink',null,'0,3 l',10,false,true,'Lemoniada czerwona pomarańcza','0,3 l','size','lemoniada_pomarancza',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],82,60,array['czerwona pomarańcza','cytryna','rozmaryn','woda','cukier'],array[]::text[]),
('acced74f-ddac-43a0-9f78-016c397f4b8e'::uuid,'Lemoniada czerwona pomarańcza 0,5 l','Domowa lemoniada z czerwonej pomarańczy i rozmarynu.','Napoje','drink',null,'0,5 l',15,false,true,'Lemoniada czerwona pomarańcza','0,5 l','size','lemoniada_pomarancza',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],78,60,array['czerwona pomarańcza','cytryna','rozmaryn','woda','cukier'],array[]::text[]),

-- Ruszt i Ogień: 17 rows / 13 families
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Skrzydełka z rusztu — łagodne','Skrzydełka z dymną glazurą BBQ i szczypiorem.','Na początek','starter','chicken','łagodne',27,false,false,'Skrzydełka z rusztu','łagodne','spice','skrzydelka_ruszt',array['skrzydelka','kurczak z grilla'],array['grill','miesne'],array[]::text[],86,10,array['skrzydełka kurczaka','sos BBQ','szczypior'],array['gorczyca']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Skrzydełka z rusztu — ogniste','Skrzydełka z glazurą chili, jalapeño i szczypiorem.','Na początek','starter','chicken','ogniste',29,true,false,'Skrzydełka z rusztu','ogniste','spice','skrzydelka_ruszt',array['ostre skrzydelka','pikantny kurczak'],array['grill','miesne','spicy'],array[]::text[],91,10,array['skrzydełka kurczaka','chili','jalapeño','sos BBQ'],array['gorczyca']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Żeberka dymione 350 g','Żeberka wieprzowe, glazura śliwkowa, pikle i coleslaw.','Z rusztu','grill','pork','350 g',44,false,false,'Żeberka dymione','350 g','size','zeberka_dymione',array['zeberka','zeberka z grilla'],array['grill','miesne'],array['gluten_free'],96,20,array['żeberka wieprzowe','śliwka','kapusta','marchew','gorczyca'],array['gorczyca','jaja']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Żeberka dymione 550 g','Żeberka wieprzowe, glazura śliwkowa, pikle i coleslaw.','Z rusztu','grill','pork','550 g',59,false,false,'Żeberka dymione','550 g','size','zeberka_dymione',array['zeberka','duze zeberka'],array['grill','miesne'],array['gluten_free'],92,20,array['żeberka wieprzowe','śliwka','kapusta','marchew','gorczyca'],array['gorczyca','jaja']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Stek z rostbefu 200 g','Rostbef wołowy, masło ziołowe i pieczony czosnek; stopień wysmażenia podaj w uwagach.','Z rusztu','steak','beef','200 g',62,false,false,'Stek z rostbefu','200 g','size','stek_rostbef',array['stek','rostbef','wolowina z grilla'],array['grill','miesne','steak'],array['gluten_free'],95,20,array['rostbef wołowy','masło','zioła','czosnek'],array['mleko']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Stek z rostbefu 300 g','Rostbef wołowy, masło ziołowe i pieczony czosnek; stopień wysmażenia podaj w uwagach.','Z rusztu','steak','beef','300 g',82,false,false,'Stek z rostbefu','300 g','size','stek_rostbef',array['stek','duzy stek','wolowina z grilla'],array['grill','miesne','steak'],array['gluten_free'],90,20,array['rostbef wołowy','masło','zioła','czosnek'],array['mleko']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Kurczak z ognia','Udko bez kości, cytrynowa marynata, grillowana kukurydza i salsa ziołowa.','Z rusztu','grill','chicken',null,39,false,false,'Kurczak z ognia',null,null,'kurczak_ogien',array['kurczak z grilla','grillowany kurczak'],array['grill','miesne'],array['gluten_free'],88,20,array['kurczak','cytryna','kukurydza','zioła'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Kanapka z szarpaną wieprzowiną','Bułka brioche, szarpana wieprzowina, BBQ, pikle i coleslaw.','Kanapki','sandwich','pork',null,36,false,false,'Kanapka z szarpaną wieprzowiną',null,null,'pulled_pork_sandwich',array['pulled pork','kanapka bbq'],array['grill','miesne'],array[]::text[],89,30,array['bułka brioche','wieprzowina','sos BBQ','kapusta','marchew'],array['gluten','jaja','gorczyca']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Halloumi z rusztu','Grillowane halloumi, papryka, cukinia, mięta i sos cytrynowy.','Bez mięsa','grill',null,null,37,false,true,'Halloumi z rusztu',null,null,'halloumi_ruszt',array['grillowany ser','halloumi'],array['grill','vege'],array['vegetarian','gluten_free'],84,30,array['halloumi','papryka','cukinia','mięta','cytryna'],array['mleko']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Warzywa z żaru','Bakłażan, papryka, cukinia, cebula i sos z pieczonego pomidora.','Bez mięsa','grill',null,null,29,false,true,'Warzywa z żaru',null,null,'warzywa_zar',array['grillowane warzywa','warzywa z grilla'],array['grill','vege'],array['vegan','gluten_free','lactose_free'],76,30,array['bakłażan','papryka','cukinia','cebula','pomidor'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Ziemniak z ognia — wołowina','Pieczony ziemniak, szarpana wołowina, cheddar i sos szczypiorkowy.','Dodatki','side','beef','wołowina',32,false,false,'Ziemniak z ognia','wołowina','protein','ziemniak_ogien',array['pieczony ziemniak','ziemniak z miesem'],array['grill','miesne'],array['gluten_free'],82,40,array['ziemniak','wołowina','cheddar','śmietana','szczypior'],array['mleko']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Ziemniak z ognia — fasola','Pieczony ziemniak, dymiona fasola, kukurydza i salsa ziołowa.','Dodatki','side',null,'fasola',27,false,true,'Ziemniak z ognia','fasola','protein','ziemniak_ogien',array['pieczony ziemniak vege','ziemniak z fasola'],array['grill','vege'],array['vegan','gluten_free','lactose_free'],74,40,array['ziemniak','fasola','kukurydza','pomidor','zioła'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Frytki z solą wędzoną','Grube frytki z wędzoną solą.','Dodatki','side',null,null,14,false,true,'Frytki z solą wędzoną',null,null,'frytki_wedzone',array['frytki','grube frytki'],array['dodatek','vege'],array['vegan','gluten_free','lactose_free'],80,40,array['ziemniaki','olej','sól wędzona'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Coleslaw jabłkowy','Kapusta, marchew, jabłko i kremowy dressing.','Dodatki','side',null,null,12,false,true,'Coleslaw jabłkowy',null,null,'coleslaw_jablko',array['coleslaw','surowka'],array['dodatek','vege'],array['vegetarian','gluten_free'],68,40,array['kapusta','marchew','jabłko','majonez','gorczyca'],array['jaja','gorczyca']),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Ananas z żaru','Grillowany ananas, karmel z limonki i sorbet kokosowy.','Desery','dessert',null,null,22,false,true,'Ananas z żaru',null,null,'ananas_zar',array['grillowany ananas','deser kokosowy'],array['deser','vege'],array['vegan','gluten_free','lactose_free'],73,50,array['ananas','limonka','cukier','kokos'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Lemoniada dymny grejpfrut 0,3 l','Grejpfrut, cytryna, rozmaryn i delikatnie dymny syrop.','Napoje','drink',null,'0,3 l',10,false,true,'Lemoniada dymny grejpfrut','0,3 l','size','lemoniada_grejpfrut',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],78,60,array['grejpfrut','cytryna','rozmaryn','woda','cukier'],array[]::text[]),
('6cce66fb-4d2d-402f-abe5-22e9784d559c'::uuid,'Lemoniada dymny grejpfrut 0,5 l','Grejpfrut, cytryna, rozmaryn i delikatnie dymny syrop.','Napoje','drink',null,'0,5 l',15,false,true,'Lemoniada dymny grejpfrut','0,5 l','size','lemoniada_grejpfrut',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],74,60,array['grejpfrut','cytryna','rozmaryn','woda','cukier'],array[]::text[]),

-- Syto po Naszymu: 18 rows / 13 families
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Rosół z domowym makaronem','Klarowny rosół drobiowo-wołowy z domowym makaronem i natką.','Zupy','soup','mixed',null,18,false,false,'Rosół z domowym makaronem',null,null,'rosol',array['rosol','zupa z makaronem'],array['zupa','domowe'],array[]::text[],90,10,array['kurczak','wołowina','warzywa','makaron jajeczny'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pomidorowa z ryżem','Kremowa zupa pomidorowa na warzywnym wywarze z ryżem.','Zupy','soup',null,null,17,false,true,'Pomidorowa z ryżem',null,null,'pomidorowa',array['zupa pomidorowa','pomidorowa'],array['zupa','vege'],array['vegetarian','gluten_free'],85,10,array['pomidor','warzywa','ryż','śmietanka'],array['mleko']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Kotlet schabowy — standard','Kotlet schabowy, ziemniaki z koperkiem i kapusta zasmażana.','Dania główne','main','pork','standard',34,false,false,'Kotlet schabowy','standard','size','schabowy',array['schabowy','kotlet wieprzowy'],array['obiad','miesne'],array[]::text[],96,20,array['schab wieprzowy','bułka tarta','jaja','ziemniaki','kapusta'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Kotlet schabowy — duży','Duży kotlet schabowy, ziemniaki z koperkiem i kapusta zasmażana.','Dania główne','main','pork','duży',43,false,false,'Kotlet schabowy','duży','size','schabowy',array['duzy schabowy','kotlet wieprzowy'],array['obiad','miesne'],array[]::text[],92,20,array['schab wieprzowy','bułka tarta','jaja','ziemniaki','kapusta'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pulpety w sosie koperkowym','Pulpety wieprzowo-wołowe, sos koperkowy, puree i buraczki.','Dania główne','main','mixed',null,32,false,false,'Pulpety w sosie koperkowym',null,null,'pulpety_koper',array['pulpety','klopsiki','mielone'],array['obiad','miesne'],array[]::text[],87,20,array['wieprzowina','wołowina','śmietanka','koperek','ziemniaki','buraki'],array['gluten','mleko','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pierś kurczaka z warzywami','Grillowana pierś kurczaka, ziemniaki opiekane i warzywa sezonowe.','Dania główne','main','chicken',null,35,false,false,'Pierś kurczaka z warzywami',null,null,'kurczak_warzywa',array['kurczak z warzywami','grillowany kurczak'],array['obiad','miesne'],array['gluten_free'],84,20,array['kurczak','ziemniaki','warzywa sezonowe','zioła'],array[]::text[]),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pierogi — z mięsem','Pierogi ręcznie lepione z mięsem i cebulką.','Pierogi','dumpling','mixed','z mięsem',28,false,false,'Pierogi','z mięsem','flavour','pierogi',array['pierogi z miesem','pierogi miesne'],array['pierogi','miesne'],array[]::text[],91,30,array['mąka pszenna','jaja','wieprzowina','wołowina','cebula'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pierogi — ruskie','Pierogi z ziemniakami, twarogiem i cebulką.','Pierogi','dumpling',null,'ruskie',27,false,true,'Pierogi','ruskie','flavour','pierogi',array['pierogi ruskie','pierogi z serem'],array['pierogi','vege'],array['vegetarian'],93,30,array['mąka pszenna','jaja','ziemniaki','twaróg','cebula'],array['gluten','jaja','mleko']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Pierogi — kapusta i grzyby','Pierogi z kiszoną kapustą, grzybami i cebulką.','Pierogi','dumpling',null,'kapusta i grzyby',27,false,true,'Pierogi','kapusta i grzyby','flavour','pierogi',array['pierogi z kapusta','pierogi z grzybami'],array['pierogi','vege'],array['vegan','lactose_free'],86,30,array['mąka pszenna','kapusta kiszona','grzyby','cebula'],array['gluten']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Placki ziemniaczane z sosem grzybowym','Chrupiące placki, kremowy sos grzybowy i natka.','Bez mięsa','main',null,null,29,false,true,'Placki ziemniaczane z sosem grzybowym',null,null,'placki_grzyby',array['placki ziemniaczane','placki z grzybami'],array['obiad','vege'],array['vegetarian'],83,40,array['ziemniaki','cebula','jaja','grzyby','śmietanka'],array['jaja','mleko']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Naleśniki z serem i wanilią','Naleśniki z twarogiem waniliowym, śmietaną i owocami.','Bez mięsa','main',null,null,26,false,true,'Naleśniki z serem i wanilią',null,null,'nalesniki_ser',array['nalesniki z serem','slodkie nalesniki'],array['obiad','vege','slodkie'],array['vegetarian'],81,40,array['mąka pszenna','jaja','mleko','twaróg','wanilia','owoce'],array['gluten','jaja','mleko']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Miska kaszy z pieczonymi warzywami','Kasza gryczana, pieczone warzywa, kiszony ogórek i sos ziołowy.','Bez mięsa','bowl',null,null,29,false,true,'Miska kaszy z pieczonymi warzywami',null,null,'miska_kasza',array['kasza z warzywami','obiad weganski','bez glutenu'],array['obiad','vege'],array['vegan','gluten_free','lactose_free'],77,40,array['kasza gryczana','marchew','burak','cukinia','ogórek kiszony','zioła'],array[]::text[]),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Zestaw rodzinny — dla 2 osób','Dwa schabowe, ziemniaki, kapusta, dwa małe rosoły i kompot 0,5 l.','Zestawy','set','pork','2 osoby',79,false,false,'Zestaw rodzinny','2 osoby','size','zestaw_rodzinny',array['obiad dla dwojga','zestaw dla dwoch'],array['zestaw','family'],array[]::text[],88,50,array['schab wieprzowy','bułka tarta','jaja','ziemniaki','kapusta','rosół','makaron','kompot'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Zestaw rodzinny — dla 4 osób','Cztery schabowe, ziemniaki, kapusta, cztery małe rosoły i kompot 1 l.','Zestawy','set','pork','4 osoby',149,false,false,'Zestaw rodzinny','4 osoby','size','zestaw_rodzinny',array['obiad rodzinny','zestaw dla czterech'],array['zestaw','family'],array[]::text[],84,50,array['schab wieprzowy','bułka tarta','jaja','ziemniaki','kapusta','rosół','makaron','kompot'],array['gluten','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Szarlotka na ciepło','Szarlotka z cynamonem i kleksem kwaśnej śmietany.','Desery','dessert',null,null,18,false,true,'Szarlotka na ciepło',null,null,'szarlotka',array['szarlotka','ciasto z jablkami'],array['deser','vege'],array['vegetarian'],79,60,array['jabłka','mąka pszenna','masło','cukier','cynamon','śmietana'],array['gluten','mleko','jaja']),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Kompot domowy 0,3 l','Kompot z sezonowych owoców.','Napoje','drink',null,'0,3 l',8,false,true,'Kompot domowy','0,3 l','size','kompot_domowy',array['kompot','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],87,70,array['owoce sezonowe','woda','cukier'],array[]::text[]),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Kompot domowy 0,5 l','Kompot z sezonowych owoców.','Napoje','drink',null,'0,5 l',12,false,true,'Kompot domowy','0,5 l','size','kompot_domowy',array['kompot','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],82,70,array['owoce sezonowe','woda','cukier'],array[]::text[]),
('a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'::uuid,'Maślanka 0,4 l','Schłodzona naturalna maślanka.','Napoje','drink',null,'0,4 l',7,false,true,'Maślanka','0,4 l','size','maslanka',array['maslanka','napoj mleczny'],array['napoj','vege'],array['vegetarian','gluten_free'],70,70,array['maślanka'],array['mleko']),

-- Kebs & Roll: 22 rows / 12 families
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo wołowina M','Tortilla, wołowina, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','beef','M',24,false,false,'Rollo wołowina','M','size','rollo_wolowina',array['rollo wolowe','kebab z wolowina'],array['kebab','miesne'],array[]::text[],94,10,array['tortilla pszenna','wołowina','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo wołowina L','Tortilla, wołowina, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','beef','L',29,false,false,'Rollo wołowina','L','size','rollo_wolowina',array['duze rollo wolowe','kebab z wolowina'],array['kebab','miesne'],array[]::text[],96,10,array['tortilla pszenna','wołowina','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo wołowina XL','Tortilla, podwójna wołowina, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','beef','XL',36,false,false,'Rollo wołowina','XL','size','rollo_wolowina',array['rollo xl','duzy kebab z wolowina'],array['kebab','miesne'],array[]::text[],91,10,array['tortilla pszenna','wołowina','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo kurczak M','Tortilla, grillowany kurczak, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','chicken','M',22,false,false,'Rollo kurczak','M','size','rollo_kurczak',array['rollo z kurczakiem','kebab kurczak'],array['kebab','miesne'],array[]::text[],92,10,array['tortilla pszenna','kurczak','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo kurczak L','Tortilla, grillowany kurczak, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','chicken','L',27,false,false,'Rollo kurczak','L','size','rollo_kurczak',array['duze rollo z kurczakiem','kebab kurczak'],array['kebab','miesne'],array[]::text[],94,10,array['tortilla pszenna','kurczak','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo kurczak XL','Tortilla, podwójny kurczak, sałata, pomidor, cebula i sos do wyboru.','Rollo','kebab','chicken','XL',34,false,false,'Rollo kurczak','XL','size','rollo_kurczak',array['rollo xl z kurczakiem','duzy kebab kurczak'],array['kebab','miesne'],array[]::text[],89,10,array['tortilla pszenna','kurczak','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo mix M','Tortilla, wołowina i kurczak, warzywa oraz sos do wyboru.','Rollo','kebab','mixed','M',24,false,false,'Rollo mix','M','size','rollo_mix',array['kebab mieszany','rollo mix'],array['kebab','miesne'],array[]::text[],90,10,array['tortilla pszenna','wołowina','kurczak','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo mix L','Tortilla, wołowina i kurczak, warzywa oraz sos do wyboru.','Rollo','kebab','mixed','L',30,false,false,'Rollo mix','L','size','rollo_mix',array['duzy kebab mieszany','rollo mix'],array['kebab','miesne'],array[]::text[],88,10,array['tortilla pszenna','wołowina','kurczak','sałata','pomidor','cebula'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo falafel M','Tortilla, falafel, hummus, sałata, pomidor, cebula i pikle.','Rollo','kebab',null,'M',21,false,true,'Rollo falafel','M','size','rollo_falafel',array['kebab wege','rollo falafel'],array['kebab','vege'],array['vegan','lactose_free'],86,10,array['tortilla pszenna','ciecierzyca','sezam','sałata','pomidor','cebula','pikle'],array['gluten','sezam']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Rollo falafel L','Tortilla, falafel, hummus, sałata, pomidor, cebula i pikle.','Rollo','kebab',null,'L',26,false,true,'Rollo falafel','L','size','rollo_falafel',array['duzy kebab wege','rollo falafel'],array['kebab','vege'],array['vegan','lactose_free'],82,10,array['tortilla pszenna','ciecierzyca','sezam','sałata','pomidor','cebula','pikle'],array['gluten','sezam']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Pita z mięsem','Pita, wołowina, warzywa, pikle i sos do wyboru.','Pita','kebab','beef',null,25,false,false,'Pita z mięsem',null,null,'pita_mieso',array['kebab w picie','pita wolowina'],array['kebab','miesne'],array[]::text[],85,20,array['pita pszenna','wołowina','sałata','pomidor','cebula','pikle'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Pita z falafelem','Pita, falafel, hummus, warzywa i pikle.','Pita','kebab',null,null,23,false,true,'Pita z falafelem',null,null,'pita_falafel',array['pita wege','kebab wege w picie'],array['kebab','vege'],array['vegan','lactose_free'],78,20,array['pita pszenna','ciecierzyca','sezam','sałata','pomidor','pikle'],array['gluten','sezam']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Kebab box M','Wołowina, frytki, warzywa i sos do wyboru.','Box','kebab','beef','M',25,false,false,'Kebab box','M','size','kebab_box',array['box z miesem','kebab z frytkami'],array['kebab','miesne'],array['gluten_free'],88,30,array['wołowina','ziemniaki','sałata','pomidor','cebula'],array[]::text[]),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Kebab box L','Wołowina, frytki, warzywa i sos do wyboru.','Box','kebab','beef','L',31,false,false,'Kebab box','L','size','kebab_box',array['duzy box z miesem','kebab z frytkami'],array['kebab','miesne'],array['gluten_free'],84,30,array['wołowina','ziemniaki','sałata','pomidor','cebula'],array[]::text[]),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Loaded fries — wołowina','Frytki, wołowina, cheddar, jalapeño, cebulka i sos firmowy.','Przekąski','side','beef','wołowina',29,true,false,'Loaded fries','wołowina','protein','loaded_fries',array['frytki z kebabem','frytki z miesem'],array['kebab','spicy','miesne'],array['gluten_free'],87,40,array['ziemniaki','wołowina','cheddar','jalapeño','cebula'],array['mleko']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Loaded fries — falafel','Frytki, falafel, hummus, pikle, jalapeño i zioła.','Przekąski','side',null,'falafel',27,true,true,'Loaded fries','falafel','protein','loaded_fries',array['frytki z falafelem','frytki wege'],array['kebab','spicy','vege'],array['vegan','gluten_free','lactose_free'],79,40,array['ziemniaki','ciecierzyca','sezam','pikle','jalapeño','zioła'],array['sezam']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Hummus bowl','Hummus, pieczona ciecierzyca, warzywa, pikle i zioła.','Bez mięsa','bowl',null,null,28,false,true,'Hummus bowl',null,null,'hummus_bowl',array['miska hummus','hummus z warzywami','bez glutenu'],array['vege','bowl'],array['vegan','gluten_free','lactose_free'],75,40,array['ciecierzyca','sezam','pomidor','ogórek','pikle','zioła'],array['sezam']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Sałatka fattoush','Sałata, pomidor, ogórek, rzodkiewka, zioła i chrupiąca pita.','Bez mięsa','salad',null,null,25,false,true,'Sałatka fattoush',null,null,'fattoush',array['salatka arabska','salatka z pita'],array['vege','salatka'],array['vegan','lactose_free'],72,40,array['sałata','pomidor','ogórek','rzodkiewka','pita pszenna','zioła'],array['gluten']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Baklava pistacjowa','Kruche ciasto filo, pistacje i syrop cytrusowy.','Desery','dessert',null,null,16,false,true,'Baklava pistacjowa',null,null,'baklava',array['baklawa','deser pistacjowy'],array['deser','vege'],array['vegetarian','lactose_free'],80,50,array['ciasto filo','pistacje','cukier','cytryna'],array['gluten','orzechy']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Ayran 0,3 l','Schłodzony napój jogurtowy z odrobiną soli.','Napoje','drink',null,'0,3 l',8,false,true,'Ayran','0,3 l','size','ayran',array['ayran','napoj do kebaba'],array['napoj','vege'],array['vegetarian','gluten_free'],85,60,array['jogurt','woda','sól'],array['mleko']),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Lemoniada granat 0,3 l','Granat, cytryna, mięta i woda gazowana.','Napoje','drink',null,'0,3 l',9,false,true,'Lemoniada granat','0,3 l','size','lemoniada_granat',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],78,60,array['granat','cytryna','mięta','woda','cukier'],array[]::text[]),
('72c76694-f533-46b8-b831-1965210a0cb4'::uuid,'Lemoniada granat 0,5 l','Granat, cytryna, mięta i woda gazowana.','Napoje','drink',null,'0,5 l',14,false,true,'Lemoniada granat','0,5 l','size','lemoniada_granat',array['lemoniada','cos do picia'],array['napoj','vege'],array['vegan','gluten_free','lactose_free'],74,60,array['granat','cytryna','mięta','woda','cukier'],array[]::text[])
)
insert into public.menu_items_v2 (
  restaurant_id, name, description, category, base_type, meat_type,
  size_or_variant, price_pln, spicy, is_vege, image_url, available,
  base_name, variant_name, variant_type, item_family, item_aliases,
  item_tags, dietary_flags, popularity_score, section_order, safety_data
)
select
  restaurant_id, name, description, category, base_type, meat_type,
  size_or_variant, price_pln, spicy, is_vege, null, true,
  base_name, variant_name, variant_type, item_family, item_aliases,
  item_tags, dietary_flags, popularity_score, section_order,
  jsonb_build_object(
    'ingredients', to_jsonb(ingredients),
    'allergens', to_jsonb(allergens),
    'dietary', to_jsonb(dietary_flags)
  )
from items;

do $$
declare
  total_count integer;
  invalid_count integer;
  counts jsonb;
begin
  select count(*) into total_count
  from public.menu_items_v2
  where restaurant_id in (
    'acced74f-ddac-43a0-9f78-016c397f4b8e',
    '6cce66fb-4d2d-402f-abe5-22e9784d559c',
    'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
    '72c76694-f533-46b8-b831-1965210a0cb4'
  );

  select count(*) into invalid_count
  from public.menu_items_v2
  where restaurant_id in (
    'acced74f-ddac-43a0-9f78-016c397f4b8e',
    '6cce66fb-4d2d-402f-abe5-22e9784d559c',
    'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
    '72c76694-f533-46b8-b831-1965210a0cb4'
  ) and (
    price_pln <= 0 or item_family is null or category is null
    or safety_data is null or jsonb_typeof(safety_data->'ingredients') <> 'array'
    or jsonb_typeof(safety_data->'allergens') <> 'array'
    or jsonb_typeof(safety_data->'dietary') <> 'array'
  );

  select jsonb_object_agg(name, item_count) into counts
  from (
    select r.name, count(m.id)::integer as item_count
    from public.restaurants r
    left join public.menu_items_v2 m on m.restaurant_id = r.id
    where r.id in (
      'acced74f-ddac-43a0-9f78-016c397f4b8e',
      '6cce66fb-4d2d-402f-abe5-22e9784d559c',
      'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
      '72c76694-f533-46b8-b831-1965210a0cb4'
    )
    group by r.name
  ) grouped;

  if total_count <> 74 or invalid_count <> 0
     or counts <> '{"Kebs & Roll":22,"Ruszt i Ogień":17,"Silesiana Italiana":17,"Syto po Naszymu":18}'::jsonb then
    raise exception 'Demo seed verification failed: total %, invalid %, counts %', total_count, invalid_count, counts;
  end if;
end $$;

update public.restaurants
set is_active = true, updated_at = now()
where id in (
  'acced74f-ddac-43a0-9f78-016c397f4b8e',
  '6cce66fb-4d2d-402f-abe5-22e9784d559c',
  'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
  '72c76694-f533-46b8-b831-1965210a0cb4'
);

commit;

