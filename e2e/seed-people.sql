-- The people the browser tests sign in as. The demo shops come from supabase/seed.sql.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'asha@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'admin@example.test')
on conflict do nothing;
update public.profiles set full_name = 'Asha Reddy', phone = '9123456780' where id = '11111111-1111-4111-8111-111111111111';
insert into public.user_roles (user_id, role) values ('55555555-5555-4555-8555-555555555555', 'admin') on conflict do nothing;
insert into public.user_roles (user_id, role) select user_id, 'seller' from public.sellers on conflict do nothing;
-- Open all day, so the tests never depend on the time they run at.
update public.sellers set open_time = '00:00', close_time = '00:00';
