-- Removes only the four fictional demo tenants and their menu rows.
-- Existing restaurants and orders are not modified.

begin;

update public.restaurants
set is_active = false, updated_at = now()
where id in (
  'acced74f-ddac-43a0-9f78-016c397f4b8e',
  '6cce66fb-4d2d-402f-abe5-22e9784d559c',
  'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
  '72c76694-f533-46b8-b831-1965210a0cb4'
);

delete from public.menu_items_v2
where restaurant_id in (
  'acced74f-ddac-43a0-9f78-016c397f4b8e',
  '6cce66fb-4d2d-402f-abe5-22e9784d559c',
  'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
  '72c76694-f533-46b8-b831-1965210a0cb4'
);

delete from public.restaurants
where id in (
  'acced74f-ddac-43a0-9f78-016c397f4b8e',
  '6cce66fb-4d2d-402f-abe5-22e9784d559c',
  'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
  '72c76694-f533-46b8-b831-1965210a0cb4'
) and owner_id is null and business_id is null;

commit;

