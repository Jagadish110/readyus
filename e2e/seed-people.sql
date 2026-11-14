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

-- One cash order waiting at Paradise Corner Biryani, so the shop's order board has something to show.
insert into public.addresses (id, user_id, label, recipient, phone, line1, line2, landmark, city, pincode, location, is_default)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Home', 'Asha Reddy', '9123456780',
        'Flat 302, Sai Residency', 'Main Road', 'Near the post office', 'Test City', '500001',
        st_setsrid(st_makepoint(78.4872, 17.3858), 4326)::geography, true)
on conflict do nothing;
insert into public.cart_items (user_id, product_id, seller_id, quantity)
select '11111111-1111-4111-8111-111111111111', p.id, p.seller_id, 1
from public.products p join public.sellers s on s.id = p.seller_id
where s.shop_name = 'Paradise Corner Biryani' and p.approval_status = 'approved'
order by p.name limit 1
on conflict do nothing;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public.place_order('22222222-2222-4222-8222-222222222222',
                          (select id from public.sellers where shop_name = 'Paradise Corner Biryani'), false, '');
commit;
-- Shops get 5 minutes to accept; the build before the tests can take longer, so this order waits a day.
update public.orders set accept_deadline_at = now() + interval '1 day' where status = 'pending';
