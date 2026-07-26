-- Official preview toggle for the fictional Śląski Szynk tenant.
-- The UUID is stable; no other restaurants are modified.

begin;

update public.restaurants
set
  is_active = true,
  -- Przybliżony punkt demonstracyjny, potrzebny do wyszukiwania GPS w Live.
  lat = 50.387,
  lng = 18.948,
  updated_at = now()
where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
  and name = 'Śląski Szynk'
  and owner_id is null
  and business_id is null;

do $$
begin
  if not exists (
    select 1
    from public.restaurants
    where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
      and name = 'Śląski Szynk'
      and is_active = true
      and lat is not null
      and lng is not null
  ) then
    raise exception 'Śląski Szynk preview activation failed';
  end if;
end $$;

commit;

-- Fast hide command (execute separately when needed):
-- update public.restaurants
-- set is_active = false
-- where id = '4ad6b301-671b-4343-bf91-9bab7cda37b4'
--   and name = 'Śląski Szynk';
