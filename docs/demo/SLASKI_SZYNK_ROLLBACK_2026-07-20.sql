-- SEMANTIC ROLLBACK: Śląski Szynk -> Kebab u Orła
-- This restores the original restaurant fields and four original menu rows.
-- It intentionally does not delete orders created after the seed.

begin;

do $$
declare
  current_name text;
begin
  select name into current_name
  from public.restaurants
  where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
  for update;

  if current_name <> 'Śląski Szynk' then
    raise exception 'Refusing rollback: unexpected restaurant name: %', current_name;
  end if;
end $$;

delete from public.menu_items_v2
where restaurant_id = '4ad6b301-671b-4343-bf91-9bab7cda37b4';

insert into public.menu_items_v2 (
  id, restaurant_id, name, description, category, base_type, meat_type,
  size_or_variant, price_pln, spicy, is_vege, image_url, available,
  created_at, base_name, variant_name, variant_type, item_family,
  item_aliases, item_tags, dietary_flags, popularity_score, section_order, safety_data
)
values
('21213dfc-ee90-467b-b656-60244e6e7675', '4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kebab w bułce', null, null, null, null, null, 18, false, false, null, true, '2026-05-05T17:11:38.747361+00:00', null, null, null, null, array[]::text[], array[]::text[], array[]::text[], 0, 0, '{}'::jsonb),
('7e724adb-b29e-4fe6-b81e-0dc2e73fb0c5', '4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kebab na talerzu', null, null, null, null, null, 25, false, false, '/menu/8/image-1077588262106960.jpeg', true, '2026-05-05T17:11:38.747361+00:00', null, null, null, null, array[]::text[], array[]::text[], array[]::text[], 0, 0, '{}'::jsonb),
('9ed72f72-5042-443f-9294-50a1c7979883', '4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kebab Box', null, null, null, null, null, 22, false, false, '/menu/8/image-1077587422107044.jpeg', true, '2026-05-05T17:11:38.747361+00:00', null, null, null, null, array[]::text[], array[]::text[], array[]::text[], 0, 0, '{}'::jsonb),
('f0d4fc4d-bef6-47a0-ad9c-e07205639be2', '4ad6b301-671b-4343-bf91-9bab7cda37b4', 'Kebab rollo', null, null, null, null, null, 20, false, false, '/menu/8/image-1077586748773778.jpeg', true, '2026-05-05T17:11:38.747361+00:00', null, null, null, null, array[]::text[], array[]::text[], array[]::text[], 0, 0, '{}'::jsonb);

update public.restaurants
set
  name = 'Kebab u Orła',
  address = 'Piekary Śląskie',
  city = 'Piekary Śląskie',
  lat = null,
  lng = null,
  cuisine_type = 'Kebab',
  rating = null,
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
  taxonomy_groups = array[]::text[],
  taxonomy_cats = array[]::text[],
  taxonomy_tags = array[]::text[],
  taxonomy_vibes = array[]::text[],
  taxonomy_dietarys = array[]::text[],
  phone = null,
  website = null,
  maps_rating = null,
  maps_place_id = null,
  maps_url = null,
  maps_ratings_total = null,
  photo_gallery = null
where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4';

update public.orders
set status = 'pending'
where id = '4ce2dc5e-c45b-4b5e-86b9-3772e162c320'
  and restaurant_name = 'Kebab u Orła'
  and status = 'cancelled';

commit;
