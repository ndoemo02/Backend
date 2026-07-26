-- DATA SEED: hidden demo tenant -> Śląski Szynk
-- Target project: ezemaacyyvbpjlagchds
-- Target restaurant: 4ad6b301-671b-4343-bf91-9bab7cda37b4
-- This is data-only. It does not alter the schema.

begin;

do $$
declare
  current_name text;
begin
  select name into current_name
  from public.restaurants
  where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
  for update;

  if current_name is null then
    raise exception 'Demo restaurant tenant does not exist';
  end if;

  if current_name not in ('Kebab u Orła', 'Śląski Szynk') then
    raise exception 'Refusing seed: unexpected restaurant name: %', current_name;
  end if;
end $$;

update public.restaurants
set
  name = 'Śląski Szynk',
  address = 'Piekary Śląskie · Lokal demonstracyjny FreeFlow — zamówienia nie są realizowane',
  city = 'Piekary Śląskie',
  -- Przybliżony punkt demonstracyjny w obszarze obsługi; nie jest adresem realnego lokalu.
  lat = 50.387,
  lng = 18.948,
  cuisine_type = 'Nowoczesna kuchnia śląska',
  rating = 4.8,
  image_url = null,
  owner_id = null,
  owner_email = null,
  business_id = null,
  partner_mode = false,
  menu_count = 0,
  is_active = false,
  opening_hours = null,
  is_open = true,
  min_order_pln = 0,
  delivery_available = true,
  price_level = 2,
  taxonomy_groups = array['polish']::text[],
  taxonomy_cats = array['tradycyjne', 'zupy']::text[],
  taxonomy_tags = array['delivery', 'vege', 'spicy']::text[],
  taxonomy_vibes = array['cozy', 'family']::text[],
  taxonomy_dietarys = array['vegetarian', 'gluten_free']::text[],
  phone = null,
  website = null,
  maps_rating = null,
  maps_place_id = null,
  maps_url = null,
  maps_ratings_total = null,
  photo_gallery = null
where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4';

-- Preserve the historical order, but keep it out of the active KDS queue.
update public.orders
set status = 'cancelled'
where restaurant_id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
  and restaurant_name = 'Kebab u Orła'
  and status = 'pending';

delete from public.menu_items_v2
where restaurant_id = '4ad6b301-671b-4343-bf91-9bab7cda37b4';

insert into public.menu_items_v2 (
  restaurant_id, name, description, category, base_type, meat_type,
  size_or_variant, price_pln, spicy, is_vege, image_url, available,
  base_name, variant_name, variant_type, item_family, item_aliases,
  item_tags, dietary_flags, popularity_score, section_order, safety_data
)
values
-- Na początek
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Hekele na żytniej grzance', 'Śląski tatar ze śledzia z ogórkiem, cebulą i musztardą, podany na chrupiącej grzance.', 'Na początek', 'starter', 'fish', null, 24, false, false, null, true, 'Hekele na żytniej grzance', null, null, 'hekele', array['hekele','śledź','tatar ze śledzia'], array['slaska','ryba','przystawka'], array[]::text[], 76, 10, '{"dietary":["fish"],"allergens":["ryby","gluten","gorczyca"],"ingredients":["śledź","ogórek kiszony","cebula","musztarda","chleb żytni"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Krupniok z jabłkiem i cebulą', 'Pieczony krupniok z karmelizowanym jabłkiem, cebulą i majerankiem.', 'Na początek', 'starter', 'pork', null, 27, false, false, null, true, 'Krupniok z jabłkiem i cebulą', null, null, 'krupniok', array['krupniok','kaszanka','śląska kaszanka'], array['slaska','miesne','przystawka'], array[]::text[], 72, 10, '{"dietary":["meat"],"allergens":["gluten"],"ingredients":["krupniok","jabłko","cebula","majeranek"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Placki ziemniaczane ze śmietaną', 'Złociste placki ziemniaczane ze śmietaną, szczypiorkiem i olejem ziołowym.', 'Na początek', 'starter', null, null, 24, false, true, null, true, 'Placki ziemniaczane ze śmietaną', null, null, 'placki_ziemniaczane', array['placki','placki kartoflane','placki ziemniaczane'], array['slaska','vege','przystawka'], array['vegetarian'], 74, 10, '{"dietary":["vegetarian"],"allergens":["mleko","jaja"],"ingredients":["ziemniaki","cebula","jaja","śmietana","szczypiorek"]}'::jsonb),

-- Zupy
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Żur śląski z białą kiełbasą 300 ml', 'Żur na żytnim zakwasie z białą kiełbasą, ziemniakiem, jajkiem i majerankiem.', 'Zupy', 'soup', 'pork', '300 ml', 22, false, false, null, true, 'Żur śląski z białą kiełbasą', '300 ml', 'size', 'zur_slaski', array['żur','żurek','żur śląski'], array['slaska','zupa','miesne'], array[]::text[], 88, 20, '{"dietary":["meat"],"allergens":["gluten","jaja","gorczyca"],"ingredients":["zakwas żytni","biała kiełbasa","ziemniaki","jajko","majeranek"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Żur śląski z białą kiełbasą 500 ml', 'Żur na żytnim zakwasie z białą kiełbasą, ziemniakiem, jajkiem i majerankiem.', 'Zupy', 'soup', 'pork', '500 ml', 29, false, false, null, true, 'Żur śląski z białą kiełbasą', '500 ml', 'size', 'zur_slaski', array['żur','żurek','żur śląski'], array['slaska','zupa','miesne'], array[]::text[], 88, 20, '{"dietary":["meat"],"allergens":["gluten","jaja","gorczyca"],"ingredients":["zakwas żytni","biała kiełbasa","ziemniaki","jajko","majeranek"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Borowikowa z łazankami', 'Kremowa zupa z leśnych borowików z domowymi łazankami i natką pietruszki.', 'Zupy', 'soup', null, null, 24, false, true, null, true, 'Borowikowa z łazankami', null, null, 'borowikowa', array['borowikowa','zupa grzybowa','grzybowa'], array['zupa','grzyby','vege'], array['vegetarian'], 80, 20, '{"dietary":["vegetarian"],"allergens":["gluten","mleko","seler"],"ingredients":["borowiki","bulion warzywny","łazanki","śmietana","pietruszka"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Krem z pieczonego ziemniaka', 'Aksamitny krem z pieczonych ziemniaków i czosnku z olejem szczypiorkowym.', 'Zupy', 'soup', null, null, 21, false, true, null, true, 'Krem z pieczonego ziemniaka', null, null, 'krem_ziemniaczany', array['krem ziemniaczany','zupa ziemniaczana','kartoflanka'], array['zupa','vege','gluten_free'], array['vegan','gluten_free','lactose_free'], 78, 20, '{"dietary":["vegan","gluten_free"],"allergens":["seler"],"ingredients":["ziemniaki","bulion warzywny","pieczony czosnek","szczypiorek"],"warnings":["Możliwy kontakt krzyżowy z glutenem — lokal demonstracyjny"]}'::jsonb),

-- Dania główne
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Rolada wołowa po śląsku — klasyczna', 'Rolada wołowa z kluskami śląskimi, modrą kapustą i sosem pieczeniowym.', 'Dania główne', 'main', 'beef', 'klasyczna', 48, false, false, null, true, 'Rolada wołowa po śląsku', 'klasyczna', 'size', 'rolada_wolowa', array['rolada','rolada wołowa','śląski obiad'], array['slaska','wolowina','obiad','miesne'], array[]::text[], 96, 30, '{"dietary":["meat"],"allergens":["gluten","jaja","gorczyca","seler"],"ingredients":["wołowina","ogórek kiszony","cebula","boczek","musztarda","kluski śląskie","modra kapusta","sos pieczeniowy"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Rolada wołowa po śląsku — duża', 'Duża rolada wołowa z kluskami śląskimi, modrą kapustą i sosem pieczeniowym.', 'Dania główne', 'main', 'beef', 'duża', 62, false, false, null, true, 'Rolada wołowa po śląsku', 'duża', 'size', 'rolada_wolowa', array['rolada','rolada wołowa','duża rolada','śląski obiad'], array['slaska','wolowina','obiad','miesne'], array[]::text[], 94, 30, '{"dietary":["meat"],"allergens":["gluten","jaja","gorczyca","seler"],"ingredients":["wołowina","ogórek kiszony","cebula","boczek","musztarda","kluski śląskie","modra kapusta","sos pieczeniowy"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Schab z kością', 'Schab z kością, ziemniaki z wody, młoda kapusta i naturalny sos pieczeniowy.', 'Dania główne', 'main', 'pork', null, 49, false, false, null, true, 'Schab z kością', null, null, 'schab_z_koscia', array['schab','kotlet schabowy','schab z kością'], array['slaska','wieprzowina','obiad','miesne'], array[]::text[], 86, 30, '{"dietary":["meat"],"allergens":["gluten","jaja","seler"],"ingredients":["schab wieprzowy","ziemniaki","kapusta","sos pieczeniowy"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Karminadel z cebulką', 'Śląski kotlet mielony z cebulką, puree ziemniaczanym i buraczkami.', 'Dania główne', 'main', 'pork', null, 42, false, false, null, true, 'Karminadel z cebulką', null, null, 'karminadel', array['karminadel','karminadle','kotlet mielony'], array['slaska','wieprzowina','obiad','miesne'], array[]::text[], 84, 30, '{"dietary":["meat"],"allergens":["gluten","jaja","mleko","gorczyca"],"ingredients":["wieprzowina","cebula","bułka","jajko","puree ziemniaczane","buraczki"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Żeberka po hutniczemu — łagodne', 'Długo pieczone żeberka w łagodnym sosie śliwkowym z pieczonymi ziemniakami.', 'Dania główne', 'main', 'pork', 'łagodne', 52, false, false, null, true, 'Żeberka po hutniczemu', 'łagodne', 'heat', 'zeberka_hutnicze', array['żeberka','żeberka po hutniczemu','łagodne żeberka'], array['slaska','wieprzowina','obiad','miesne'], array[]::text[], 82, 30, '{"dietary":["meat"],"allergens":["gorczyca","seler"],"ingredients":["żeberka wieprzowe","śliwka","ziemniaki","gorczyca"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Żeberka po hutniczemu — pikantne', 'Długo pieczone żeberka w pikantnym sosie śliwkowo-paprykowym z pieczonymi ziemniakami.', 'Dania główne', 'main', 'pork', 'pikantne', 54, true, false, null, true, 'Żeberka po hutniczemu', 'pikantne', 'heat', 'zeberka_hutnicze', array['żeberka','pikantne żeberka','ostre żeberka'], array['slaska','wieprzowina','obiad','miesne','spicy'], array[]::text[], 85, 30, '{"dietary":["meat"],"allergens":["gorczyca","seler"],"ingredients":["żeberka wieprzowe","śliwka","ostra papryka","ziemniaki","gorczyca"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Pstrąg z palonym masłem', 'Pstrąg z palonym masłem, młodymi ziemniakami, fasolką i koperkiem.', 'Dania główne', 'main', 'fish', null, 54, false, false, null, true, 'Pstrąg z palonym masłem', null, null, 'pstrag', array['pstrąg','ryba','pstrąg z masłem'], array['ryba','obiad','gluten_free'], array['gluten_free'], 79, 30, '{"dietary":["fish","gluten_free"],"allergens":["ryby","mleko"],"ingredients":["pstrąg","masło","ziemniaki","fasolka szparagowa","koperek"],"warnings":["Możliwy kontakt krzyżowy z glutenem — lokal demonstracyjny"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Gołąbki z kaszą gryczaną', 'Gołąbki z kaszą gryczaną i grzybami w sosie z pieczonych pomidorów.', 'Dania główne', 'main', null, null, 39, false, true, null, true, 'Gołąbki z kaszą gryczaną', null, null, 'golabki_gryczane', array['gołąbki','gołąbki wege','gołąbki z kaszą'], array['vege','obiad','gluten_free'], array['vegan','gluten_free','lactose_free'], 81, 30, '{"dietary":["vegan","gluten_free"],"allergens":["seler"],"ingredients":["kapusta","kasza gryczana","grzyby","pomidor","zioła"],"warnings":["Możliwy kontakt krzyżowy z glutenem — lokal demonstracyjny"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Gryczotto z leśnymi grzybami', 'Kremowa kasza gryczana z leśnymi grzybami, dojrzewającym serem i natką.', 'Dania główne', 'main', null, null, 38, false, true, null, true, 'Gryczotto z leśnymi grzybami', null, null, 'gryczotto', array['gryczotto','kasza z grzybami','danie z grzybami'], array['vege','grzyby','obiad','gluten_free'], array['vegetarian','gluten_free'], 77, 30, '{"dietary":["vegetarian","gluten_free"],"allergens":["mleko","seler"],"ingredients":["kasza gryczana","grzyby leśne","ser dojrzewający","natka pietruszki"],"warnings":["Możliwy kontakt krzyżowy z glutenem — lokal demonstracyjny"]}'::jsonb),

-- Dla bajtli
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Mała rolada z kluskami', 'Mniejsza rolada wołowa, kluski śląskie i delikatny sos pieczeniowy.', 'Dla bajtli', 'kids', 'beef', null, 31, false, false, null, true, 'Mała rolada z kluskami', null, null, 'mala_rolada', array['mała rolada','rolada dla dziecka','rolada dla bajtla'], array['slaska','dzieci','miesne'], array[]::text[], 73, 40, '{"dietary":["meat"],"allergens":["gluten","jaja","gorczyca","seler"],"ingredients":["wołowina","kluski śląskie","sos pieczeniowy"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Polędwiczki z kurczaka', 'Delikatne polędwiczki z kurczaka z frytkami lub ziemniakami i surówką z marchewki.', 'Dla bajtli', 'kids', 'chicken', null, 27, false, false, null, true, 'Polędwiczki z kurczaka', null, null, 'poledwiczki_kurczak', array['polędwiczki','kurczak dla dziecka','nuggetsy'], array['dzieci','drob','miesne'], array[]::text[], 75, 40, '{"dietary":["meat"],"allergens":["gluten","jaja"],"ingredients":["kurczak","panierka","frytki lub ziemniaki","marchew"]}'::jsonb),

-- Desery
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Szpajza cytrynowa', 'Lekki śląski krem cytrynowy z bezą i skórką cytrynową.', 'Desery', 'dessert', null, null, 18, false, true, null, true, 'Szpajza cytrynowa', null, null, 'szpajza', array['szpajza','krem cytrynowy','śląski deser'], array['slodkie','deser','vege'], array['vegetarian','gluten_free'], 83, 50, '{"dietary":["vegetarian","gluten_free"],"allergens":["jaja"],"ingredients":["jajka","cukier","cytryna"],"warnings":["Możliwy kontakt krzyżowy z glutenem — lokal demonstracyjny"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kołocz śląski — z serem', 'Tradycyjny kołocz z serem i maślaną posypką.', 'Desery', 'dessert', null, 'z serem', 17, false, true, null, true, 'Kołocz śląski', 'z serem', 'flavor', 'kolocz', array['kołocz','kołacz','ciasto śląskie'], array['slodkie','deser','vege'], array['vegetarian'], 87, 50, '{"dietary":["vegetarian"],"allergens":["gluten","mleko","jaja"],"ingredients":["mąka pszenna","ser twarogowy","masło","jaja","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kołocz śląski — z makiem', 'Tradycyjny kołocz z makiem i maślaną posypką.', 'Desery', 'dessert', null, 'z makiem', 17, false, true, null, true, 'Kołocz śląski', 'z makiem', 'flavor', 'kolocz', array['kołocz','kołacz','ciasto śląskie'], array['slodkie','deser','vege'], array['vegetarian'], 82, 50, '{"dietary":["vegetarian"],"allergens":["gluten","mleko","jaja"],"ingredients":["mąka pszenna","mak","masło","jaja","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kołocz śląski — z jabłkiem', 'Tradycyjny kołocz z jabłkiem, cynamonem i maślaną posypką.', 'Desery', 'dessert', null, 'z jabłkiem', 17, false, true, null, true, 'Kołocz śląski', 'z jabłkiem', 'flavor', 'kolocz', array['kołocz','kołacz','ciasto śląskie'], array['slodkie','deser','vege'], array['vegetarian'], 84, 50, '{"dietary":["vegetarian"],"allergens":["gluten","mleko","jaja"],"ingredients":["mąka pszenna","jabłko","cynamon","masło","jaja","cukier"]}'::jsonb),

-- Napoje bezalkoholowe
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Domowy kompot sezonowy 0,3 l', 'Kompot gotowany z sezonowych owoców, podawany na zimno.', 'Napoje', 'drink', null, '0,3 l', 9, false, true, null, true, 'Domowy kompot sezonowy', '0,3 l', 'size', 'kompot', array['kompot','domowy kompot','coś do picia'], array['napoj','vege'], array['vegan','gluten_free','lactose_free'], 89, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["owoce sezonowe","woda","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Domowy kompot sezonowy 0,5 l', 'Kompot gotowany z sezonowych owoców, podawany na zimno.', 'Napoje', 'drink', null, '0,5 l', 13, false, true, null, true, 'Domowy kompot sezonowy', '0,5 l', 'size', 'kompot', array['kompot','domowy kompot','coś do picia'], array['napoj','vege'], array['vegan','gluten_free','lactose_free'], 86, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["owoce sezonowe","woda","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Lemoniada z rokitnikiem 0,3 l', 'Cytrusowa lemoniada z rokitnikiem i miętą.', 'Napoje', 'drink', null, '0,3 l', 10, false, true, null, true, 'Lemoniada z rokitnikiem', '0,3 l', 'size', 'lemoniada_rokitnik', array['lemoniada','napój z rokitnikiem','coś do picia'], array['napoj','vege'], array['vegan','gluten_free','lactose_free'], 78, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["cytryna","rokitnik","mięta","woda","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Lemoniada z rokitnikiem 0,5 l', 'Cytrusowa lemoniada z rokitnikiem i miętą.', 'Napoje', 'drink', null, '0,5 l', 15, false, true, null, true, 'Lemoniada z rokitnikiem', '0,5 l', 'size', 'lemoniada_rokitnik', array['lemoniada','napój z rokitnikiem','coś do picia'], array['napoj','vege'], array['vegan','gluten_free','lactose_free'], 76, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["cytryna","rokitnik","mięta","woda","cukier"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kawa — espresso', 'Podwójne espresso z lokalnej palarni.', 'Napoje', 'drink', null, 'espresso', 10, false, true, null, true, 'Kawa', 'espresso', 'style', 'kawa', array['kawa','espresso','coś do picia'], array['napoj','kawa','vege'], array['vegan','gluten_free','lactose_free'], 75, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["kawa"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kawa — czarna', 'Czarna kawa z lokalnej palarni.', 'Napoje', 'drink', null, 'czarna', 12, false, true, null, true, 'Kawa', 'czarna', 'style', 'kawa', array['kawa','czarna kawa','americano','coś do picia'], array['napoj','kawa','vege'], array['vegan','gluten_free','lactose_free'], 77, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["kawa","woda"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kawa — mleczna', 'Kawa z mlekiem; dostępny również napój owsiany.', 'Napoje', 'drink', null, 'mleczna', 15, false, true, null, true, 'Kawa', 'mleczna', 'style', 'kawa', array['kawa','kawa z mlekiem','cappuccino','latte','coś do picia'], array['napoj','kawa','vege'], array['vegetarian'], 81, 60, '{"dietary":["vegetarian"],"allergens":["mleko"],"ingredients":["kawa","mleko"],"warnings":["Napój owsiany może zawierać gluten"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Herbata — czarna', 'Czarna herbata liściasta z cytryną.', 'Napoje', 'drink', null, 'czarna', 10, false, true, null, true, 'Herbata', 'czarna', 'style', 'herbata', array['herbata','czarna herbata','coś do picia'], array['napoj','herbata','vege'], array['vegan','gluten_free','lactose_free'], 70, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["czarna herbata","cytryna"]}'::jsonb),
('4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Herbata — ziołowa', 'Napar z mięty, melisy i suszonego jabłka.', 'Napoje', 'drink', null, 'ziołowa', 10, false, true, null, true, 'Herbata', 'ziołowa', 'style', 'herbata', array['herbata','herbata ziołowa','napar','coś do picia'], array['napoj','herbata','vege'], array['vegan','gluten_free','lactose_free'], 69, 60, '{"dietary":["vegan","gluten_free"],"allergens":[],"ingredients":["mięta","melisa","suszone jabłko"]}'::jsonb);

do $$
declare
  row_count integer;
  family_count integer;
begin
  select count(*), count(distinct coalesce(base_name, name))
  into row_count, family_count
  from public.menu_items_v2
  where restaurant_id = '4ad6b301-671b-4343-bf91-9bab7cda37b4';

  if row_count <> 31 or family_count <> 21 then
    raise exception 'Seed verification failed: rows %, families %', row_count, family_count;
  end if;

  if exists (
    select 1 from public.restaurants
    where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
      and is_active is distinct from false
  ) then
    raise exception 'Seed verification failed: demo restaurant became active';
  end if;
end $$;

commit;
