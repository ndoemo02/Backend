-- FreeFlow public demo: isolated Kraków tourist dataset (krakow-v1).
-- Four fictional venues, five grounded menu items each.
-- Idempotent for the four stable restaurant UUIDs.

begin;

do $$
begin
  if exists (
    select 1
    from public.restaurants
    where id in (
      'fad7a624-619f-468e-86d7-6c6859e9f094',
      'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f',
      'f5a05b98-eda6-47f3-84bd-b470b02f2558',
      '27313088-c278-4bd5-a1da-27192c15f53d'
    )
    and name not in (
      'Smok i Piec',
      'Zaułek Kazimierza',
      'Okrąglak 12',
      'Obwarzanek i Spółka'
    )
  ) then
    raise exception 'Refusing Kraków demo seed: stable UUID collision';
  end if;
end $$;

insert into public.restaurants (
  id, name, address, city, cuisine_type, rating, image_url,
  lat, lng, partner_mode, menu_count, is_active, is_open,
  min_order_pln, delivery_available, price_level,
  taxonomy_groups, taxonomy_cats, taxonomy_tags,
  taxonomy_vibes, taxonomy_dietarys
)
values
(
  'fad7a624-619f-468e-86d7-6c6859e9f094',
  'Smok i Piec',
  'Kraków · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane',
  'Kraków',
  'Nowoczesna kuchnia małopolska',
  4.8, null, 50.0541, 19.9366, false, 5, true, true, 25, true, 3,
  array['polish'], array['malopolska','obiady'], array['local','regional'],
  array['tourist','modern'], array['vegetarian']
),
(
  'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f',
  'Zaułek Kazimierza',
  'Kraków · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane',
  'Kraków',
  'Kuchnia polsko-żydowska',
  4.7, null, 50.0517, 19.9469, false, 5, true, true, 25, true, 3,
  array['polish','jewish'], array['regional','slow_food'], array['local','historic'],
  array['tourist','date_night'], array['vegetarian']
),
(
  'f5a05b98-eda6-47f3-84bd-b470b02f2558',
  'Okrąglak 12',
  'Kraków · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane',
  'Kraków',
  'Krakowski street food',
  4.6, null, 50.0521, 19.9445, false, 5, true, true, 15, true, 1,
  array['street_food'], array['zapiekanki'], array['quick','local','spicy'],
  array['tourist','casual'], array['vegetarian']
),
(
  '27313088-c278-4bd5-a1da-27192c15f53d',
  'Obwarzanek i Spółka',
  'Kraków · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane',
  'Kraków',
  'Piekarnia i śniadania',
  4.7, null, 50.0615, 19.9373, false, 5, true, true, 10, true, 1,
  array['bakery','polish'], array['obwarzanek','sniadania'], array['quick','local'],
  array['tourist','breakfast'], array['vegetarian']
)
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
  is_active = true,
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
  'fad7a624-619f-468e-86d7-6c6859e9f094',
  'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f',
  'f5a05b98-eda6-47f3-84bd-b470b02f2558',
  '27313088-c278-4bd5-a1da-27192c15f53d'
);

with items (
  restaurant_id, name, description, category, base_type, meat_type,
  price_pln, spicy, is_vege, base_name, item_family,
  item_aliases, item_tags, dietary_flags, popularity_score,
  section_order, ingredients, allergens
) as (values
-- Smok i Piec
('fad7a624-619f-468e-86d7-6c6859e9f094'::uuid,'Maczanka krakowska','Długo pieczona karkówka, sos kminkowy, cebula i rzemieślnicza bułka.','Specjały','main','pork',34,false,false,'Maczanka krakowska','maczanka',array['maczanka','kanapka z karkowka'],array['regionalne','miesne'],array[]::text[],100,10,array['karkówka','bułka pszenna','cebula','kminek'],array['gluten']),
('fad7a624-619f-468e-86d7-6c6859e9f094'::uuid,'Żurek małopolski','Żur na zakwasie z białą kiełbasą, jajkiem i ziemniakami.','Specjały','soup','pork',26,false,false,'Żurek małopolski','zurek',array['zurek','zupa na zakwasie'],array['regionalne','zupa'],array[]::text[],94,10,array['zakwas żytni','biała kiełbasa','jajko','ziemniaki'],array['gluten','jaja']),
('fad7a624-619f-468e-86d7-6c6859e9f094'::uuid,'Pierogi z bryndzą i miętą','Pierogi z bryndzą, ziemniakami i świeżą miętą, podane z masłem.','Dania','dumplings',null,32,false,true,'Pierogi z bryndzą i miętą','pierogi_bryndza',array['pierogi z bryndza','pierogi wegetarianskie'],array['regionalne','vege'],array['vegetarian'],91,20,array['mąka pszenna','bryndza','ziemniaki','mięta','masło'],array['gluten','mleko']),
('fad7a624-619f-468e-86d7-6c6859e9f094'::uuid,'Pstrąg z palonym masłem','Pstrąg pieczony w całości, palone masło, zioła i ziemniaki.','Dania','fish','fish',46,false,false,'Pstrąg z palonym masłem','pstrag',array['pstrag','pieczona ryba'],array['regionalne','ryba'],array[]::text[],88,20,array['pstrąg','masło','zioła','ziemniaki'],array['ryby','mleko']),
('fad7a624-619f-468e-86d7-6c6859e9f094'::uuid,'Kompot sezonowy','Domowy kompot z owoców sezonowych, 300 ml.','Napoje','drink',null,9,false,true,'Kompot sezonowy','kompot',array['kompot','napoj domowy'],array['napoj','bezalkoholowe'],array['vegan'],82,30,array['owoce sezonowe','woda','cukier'],array[]::text[]),

-- Zaułek Kazimierza
('d02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'::uuid,'Czulent z wołowiną','Wolno pieczony gulasz z wołowiną, fasolą, kaszą i warzywami.','Dania tradycyjne','stew','beef',42,false,false,'Czulent z wołowiną','czulent',array['czulent','gulasz z fasola'],array['tradycyjne','miesne'],array[]::text[],98,10,array['wołowina','fasola','kasza jęczmienna','warzywa'],array['gluten']),
('d02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'::uuid,'Gęsie pipki','Gęsie żołądki duszone z cebulą, majerankiem i sosem własnym.','Dania tradycyjne','main','goose',39,false,false,'Gęsie pipki','gesie_pipki',array['gesie pipki','gesie zoladki'],array['tradycyjne','miesne'],array[]::text[],92,10,array['gęsie żołądki','cebula','majeranek'],array[]::text[]),
('d02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'::uuid,'Kugel ziemniaczany','Zapiekanka ziemniaczana z cebulą, pieprzem i świeżymi ziołami.','Dania tradycyjne','main',null,28,false,true,'Kugel ziemniaczany','kugel',array['kugel','zapiekanka ziemniaczana'],array['tradycyjne','vege'],array['vegetarian','gluten_free'],89,10,array['ziemniaki','cebula','jajko','zioła'],array['jaja']),
('d02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'::uuid,'Sernik krakowski','Sernik z kratką z kruchego ciasta i skórką pomarańczową.','Desery','dessert',null,22,false,true,'Sernik krakowski','sernik_krakowski',array['sernik krakowski','sernik z kratka'],array['deser','regionalne'],array['vegetarian'],94,20,array['twaróg','jajka','mąka pszenna','skórka pomarańczowa'],array['mleko','jaja','gluten']),
('d02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'::uuid,'Herbata z miętą i miodem','Czarna herbata z miętą, cytryną i miodem, 350 ml.','Napoje','drink',null,14,false,true,'Herbata z miętą i miodem','herbata_mieta',array['herbata','herbata z mieta'],array['napoj','gorace'],array['vegetarian','gluten_free'],80,30,array['czarna herbata','mięta','cytryna','miód'],array[]::text[]),

-- Okrąglak 12
('f5a05b98-eda6-47f3-84bd-b470b02f2558'::uuid,'Zapiekanka klasyczna','Bagietka, pieczarki, ser, szczypiorek i ketchup.','Zapiekanki','street_food',null,18,false,true,'Zapiekanka klasyczna','zapiekanka_klasyczna',array['zapiekanka','klasyczna'],array['street_food','vege'],array['vegetarian'],100,10,array['bagietka pszenna','pieczarki','ser','szczypiorek'],array['gluten','mleko']),
('f5a05b98-eda6-47f3-84bd-b470b02f2558'::uuid,'Zapiekanka po góralsku','Bagietka, pieczarki, wędzony ser, żurawina i cebulka.','Zapiekanki','street_food',null,24,false,true,'Zapiekanka po góralsku','zapiekanka_goralska',array['zapiekanka goralska','zapiekanka z oscypkiem'],array['street_food','regionalne','vege'],array['vegetarian'],95,10,array['bagietka pszenna','pieczarki','wędzony ser','żurawina','cebula'],array['gluten','mleko']),
('f5a05b98-eda6-47f3-84bd-b470b02f2558'::uuid,'Zapiekanka Smoczy Ogień','Bagietka, pieczarki, ser, salami, jalapeño i pikantny sos.','Zapiekanki','street_food','pork',25,true,false,'Zapiekanka Smoczy Ogień','zapiekanka_smoczy_ogien',array['ostra zapiekanka','pikantna zapiekanka'],array['street_food','spicy','miesne'],array[]::text[],96,10,array['bagietka pszenna','pieczarki','ser','salami','jalapeño'],array['gluten','mleko']),
('f5a05b98-eda6-47f3-84bd-b470b02f2558'::uuid,'Zapiekanka Zielony Kazimierz','Bagietka, pieczarki, ser, szpinak, suszony pomidor i rukola.','Zapiekanki','street_food',null,23,false,true,'Zapiekanka Zielony Kazimierz','zapiekanka_zielona',array['zielona zapiekanka','zapiekanka ze szpinakiem'],array['street_food','vege'],array['vegetarian'],89,10,array['bagietka pszenna','pieczarki','ser','szpinak','suszony pomidor','rukola'],array['gluten','mleko']),
('f5a05b98-eda6-47f3-84bd-b470b02f2558'::uuid,'Oranżada rzemieślnicza','Naturalna oranżada cytrusowa, 330 ml.','Napoje','drink',null,11,false,true,'Oranżada rzemieślnicza','oranzada',array['oranzada','lemoniada'],array['napoj','bezalkoholowe'],array['vegan','gluten_free'],84,20,array['woda gazowana','cytrusy','cukier'],array[]::text[]),

-- Obwarzanek i Spółka
('27313088-c278-4bd5-a1da-27192c15f53d'::uuid,'Obwarzanek z solą','Klasyczny obwarzanek krakowski z grubą solą.','Obwarzanki','bakery',null,6,false,true,'Obwarzanek krakowski','obwarzanek',array['obwarzanek z sola','obwarzanek'],array['pieczywo','regionalne'],array['vegan'],100,10,array['mąka pszenna','drożdże','sól'],array['gluten']),
('27313088-c278-4bd5-a1da-27192c15f53d'::uuid,'Obwarzanek z makiem','Klasyczny obwarzanek krakowski z makiem.','Obwarzanki','bakery',null,6,false,true,'Obwarzanek krakowski','obwarzanek',array['obwarzanek z makiem','obwarzanek'],array['pieczywo','regionalne'],array['vegan'],96,10,array['mąka pszenna','drożdże','mak'],array['gluten']),
('27313088-c278-4bd5-a1da-27192c15f53d'::uuid,'Obwarzanek śniadaniowy','Obwarzanek z twarożkiem, jajkiem, rzodkiewką i szczypiorkiem.','Śniadania','sandwich',null,19,false,true,'Obwarzanek śniadaniowy','obwarzanek_sniadaniowy',array['kanapka z obwarzanka','sniadaniowy'],array['sniadanie','vege'],array['vegetarian'],93,20,array['obwarzanek','twarożek','jajko','rzodkiewka','szczypiorek'],array['gluten','mleko','jaja']),
('27313088-c278-4bd5-a1da-27192c15f53d'::uuid,'Drożdżówka z serem','Maślana drożdżówka z twarogiem i kruszonką.','Słodkie','dessert',null,12,false,true,'Drożdżówka z serem','drozdzowka_ser',array['drozdzowka','bulka z serem'],array['slodkie','vege'],array['vegetarian'],87,20,array['mąka pszenna','twaróg','masło','jajko'],array['gluten','mleko','jaja']),
('27313088-c278-4bd5-a1da-27192c15f53d'::uuid,'Kawa przelewowa','Kawa przelewowa z lokalnej palarni, 300 ml.','Napoje','drink',null,13,false,true,'Kawa przelewowa','kawa',array['kawa','czarna kawa'],array['napoj','gorace'],array['vegan','gluten_free'],88,30,array['kawa','woda'],array[]::text[])
)
insert into public.menu_items_v2 (
  restaurant_id, name, description, category, base_type, meat_type,
  price_pln, spicy, is_vege, available, base_name, variant_name,
  variant_type, item_family, item_aliases, item_tags, dietary_flags,
  popularity_score, section_order, safety_data
)
select
  restaurant_id, name, description, category, base_type, meat_type,
  price_pln, spicy, is_vege, true, base_name, null, null, item_family,
  item_aliases, item_tags, dietary_flags, popularity_score, section_order,
  jsonb_build_object(
    'ingredients', to_jsonb(ingredients),
    'allergens', to_jsonb(allergens),
    'dietary', to_jsonb(dietary_flags),
    'source', 'freeflow_demo_krakow_v1'
  )
from items;

do $$
declare
  restaurant_count integer;
  menu_count integer;
begin
  select count(*) into restaurant_count
  from public.restaurants
  where id in (
    'fad7a624-619f-468e-86d7-6c6859e9f094',
    'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f',
    'f5a05b98-eda6-47f3-84bd-b470b02f2558',
    '27313088-c278-4bd5-a1da-27192c15f53d'
  );

  select count(*) into menu_count
  from public.menu_items_v2
  where restaurant_id in (
    'fad7a624-619f-468e-86d7-6c6859e9f094',
    'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f',
    'f5a05b98-eda6-47f3-84bd-b470b02f2558',
    '27313088-c278-4bd5-a1da-27192c15f53d'
  );

  if restaurant_count <> 4 or menu_count <> 20 then
    raise exception 'Kraków demo verification failed: restaurants=%, menu=%',
      restaurant_count, menu_count;
  end if;
end $$;

commit;
