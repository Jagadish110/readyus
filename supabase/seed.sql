-- ReadyUs demo seed — generated from src/lib/data/fixtures.ts.
-- Safe to re-run. Five demo shops around Abids, Hyderabad, owned by
-- placeholder identities that cannot sign in (no password, @readyus.test).
-- Delete them all with: delete from auth.users where email like '%@readyus.test';

-- Categories
insert into public.categories (mode, key, name, sort) values
  ('food', 'biryani', 'Biryani', 0),
  ('food', 'kebabs', 'Kebabs', 1),
  ('food', 'tiffins', 'Tiffins', 2),
  ('food', 'desserts', 'Desserts', 3),
  ('food', 'bakery', 'Bakery', 4),
  ('food', 'beverages', 'Beverages', 5),
  ('items', 'staples', 'Staples', 6),
  ('items', 'household', 'Household', 7),
  ('items', 'vegetables', 'Vegetables', 8),
  ('items', 'fruits', 'Fruits', 9)
on conflict (mode, key) do update set name = excluded.name;

-- Demo owners (the on_auth_user_created trigger creates their profiles)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('ec258de3-b60b-4883-a7db-8d49c252f66a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paradise@readyus.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Paradise Corner Biryani (demo)"}', now(), now()),
  ('6dd7589d-be5f-40a3-aef9-9db2f55ace98', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lakshmi@readyus.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Sri Lakshmi Tiffin House (demo)"}', now(), now()),
  ('7fc78d02-5652-4e40-ac12-848a16ea2872', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'charminar@readyus.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Charminar Chai & Bakery (demo)"}', now(), now()),
  ('9fc3f3f6-e6e6-48dd-a9d4-f98ae7b4e3a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'balaji@readyus.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Balaji Kirana Store (demo)"}', now(), now()),
  ('3606f386-cb95-4519-aa37-6f46c0721977', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'freshfarm@readyus.test', '{"provider":"email","providers":["email"]}', '{"full_name":"FreshFarm Fruits & Veg (demo)"}', now(), now())
on conflict (id) do nothing;

-- Shops: approved, visible, pinned at their fixture distance due north of the origin
insert into public.sellers (id, user_id, shop_name, owner_name, category, listing_mode, description, address, city, location, service_radius_km, business_open, eta_minutes, status, public_visible, min_order_amount, delivery_fee, free_delivery_above, cod_available, rating, rating_count) values
  ('1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'ec258de3-b60b-4883-a7db-8d49c252f66a', 'Paradise Corner Biryani', 'Paradise Corner Biryani (demo)', 'Biryani & Kebabs', 'food', 'Dum biryani cooked in sealed handis since 1998. Family packs available.', 'Opp. GPO, Abids', 'Hyderabad', st_setsrid(st_makepoint(78.4867, 17.389312), 4326)::geography, 5, true, 32, 'approved', true, 149, 25, 499, true, 4.6, 1284),
  ('899f18db-d459-4f6c-ad0b-29af6fbedff5', '6dd7589d-be5f-40a3-aef9-9db2f55ace98', 'Sri Lakshmi Tiffin House', 'Sri Lakshmi Tiffin House (demo)', 'South Indian', 'food', 'Idli, dosa and pesarattu from 6am. Filter coffee all day.', 'Bank Street, Koti', 'Hyderabad', st_setsrid(st_makepoint(78.4867, 17.393264), 4326)::geography, 5, true, 22, 'approved', true, 99, 19, 299, true, 4.4, 642),
  ('e1b116d1-e1ac-435b-aaf2-342dce1c6019', '7fc78d02-5652-4e40-ac12-848a16ea2872', 'Charminar Chai & Bakery', 'Charminar Chai & Bakery (demo)', 'Bakery & Beverages', 'food', 'Irani chai, Osmania biscuits and fresh bakes through the day.', 'Pathergatti Road', 'Hyderabad', st_setsrid(st_makepoint(78.4867, 17.399732), 4326)::geography, 5, false, 18, 'approved', true, 60, 15, 249, true, 4.7, 2103),
  ('76769ac1-201f-4b4e-a845-4558d6e2c9c4', '9fc3f3f6-e6e6-48dd-a9d4-f98ae7b4e3a6', 'Balaji Kirana Store', 'Balaji Kirana Store (demo)', 'Grocery', 'items', 'Daily staples, pulses, oils and household supplies.', 'Troop Bazaar, Abids', 'Hyderabad', st_setsrid(st_makepoint(78.4867, 17.391648), 4326)::geography, 5, true, 40, 'approved', true, 199, 29, 799, true, 4.3, 318),
  ('88077c27-81ff-415e-a32d-c4b5ab0c64c6', '3606f386-cb95-4519-aa37-6f46c0721977', 'FreshFarm Fruits & Veg', 'FreshFarm Fruits & Veg (demo)', 'Fruits & Vegetables', 'items', 'Picked each morning from Gaddiannaram market.', 'Nampally Station Road', 'Hyderabad', st_setsrid(st_makepoint(78.4867, 17.395870), 4326)::geography, 5, true, 35, 'approved', true, 149, 25, 599, false, 4.5, 487)
on conflict (id) do update set
  location = excluded.location, business_open = excluded.business_open,
  status = 'approved', public_visible = true;

-- Products
insert into public.products (id, seller_id, name, description, category_key, listing_mode, price, mrp, unit, stock, veg_type, approval_status, public_visible, available, rating, rating_count) values
  ('d7aca56c-7f6b-4973-af5f-58fdad267feb', '1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'Chicken Dum Biryani', 'Full plate with raita and salan.', 'biryani', 'food', 320, 380, 'full plate', 40, 'non_veg', 'approved', true, true, 4.7, 512),
  ('b1b97a63-59aa-4bfd-a005-a23bfd16067e', '1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'Mutton Dum Biryani', 'Slow-cooked with bone-in mutton.', 'biryani', 'food', 420, 480, 'full plate', 18, 'non_veg', 'approved', true, true, 4.8, 388),
  ('e4eda477-5be0-4709-ab27-5abf51cf0d08', '1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'Veg Dum Biryani', 'Seasonal vegetables and saffron rice.', 'biryani', 'food', 220, 260, 'full plate', 32, 'veg', 'approved', true, true, 4.3, 176),
  ('dbb54505-b83c-42cf-ab72-4d29cb976a47', '1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'Seekh Kebab (6 pcs)', 'Charcoal grilled, with mint chutney.', 'kebabs', 'food', 260, 300, '6 pcs', 25, 'non_veg', 'approved', true, true, 4.5, 203),
  ('71623197-c759-4e0c-abbb-476d527d217e', '1a00dc56-a8ad-4064-a6c0-fcd4bc71bf63', 'Double Ka Meetha', 'Hyderabadi bread pudding with dry fruits.', 'desserts', 'food', 90, 110, 'bowl', 20, 'veg', 'approved', true, true, 4.4, 97),
  ('dc9cf6ab-9017-47a7-a2e4-68c70dfcef50', '899f18db-d459-4f6c-ad0b-29af6fbedff5', 'Idli Plate (4 pcs)', 'Steamed soft idli with sambar and chutney.', 'tiffins', 'food', 50, 60, '4 pcs', 60, 'veg', 'approved', true, true, 4.4, 221),
  ('012005ad-4f58-46ba-a0ff-07ca1d2814fd', '899f18db-d459-4f6c-ad0b-29af6fbedff5', 'Masala Dosa', 'Crisp dosa with spiced potato filling.', 'tiffins', 'food', 80, 95, '1 pc', 45, 'veg', 'approved', true, true, 4.6, 410),
  ('725c4dbe-97cc-4129-aab0-fafd1fdb329e', '899f18db-d459-4f6c-ad0b-29af6fbedff5', 'Pesarattu Upma', 'Green gram dosa served with upma.', 'tiffins', 'food', 95, null, '1 pc', 30, 'veg', 'approved', true, true, 4.5, 134),
  ('d36b1f1d-dd8c-4c94-a492-ef5029b8d72a', '899f18db-d459-4f6c-ad0b-29af6fbedff5', 'Filter Coffee', 'Strong decoction, served hot.', 'beverages', 'food', 35, null, 'cup', 100, 'veg', 'approved', true, true, 4.7, 589),
  ('d5b3c16f-d3c8-4555-a575-25238f082b67', 'e1b116d1-e1ac-435b-aaf2-342dce1c6019', 'Irani Chai', 'The classic, brewed slow.', 'beverages', 'food', 25, null, 'cup', 200, 'veg', 'approved', true, true, 4.8, 1420),
  ('b5be9daa-44ff-4d84-af86-39e66507e66a', 'e1b116d1-e1ac-435b-aaf2-342dce1c6019', 'Osmania Biscuits (250g)', 'Lightly salted tea biscuits.', 'bakery', 'food', 70, 85, '250 g', 50, 'veg', 'approved', true, true, 4.6, 332),
  ('cc2ebeb5-b568-478a-af5b-5861f5f95f43', 'e1b116d1-e1ac-435b-aaf2-342dce1c6019', 'Veg Puff', 'Flaky pastry with spiced filling.', 'bakery', 'food', 30, null, '1 pc', 80, 'veg', 'approved', true, true, 4.2, 188),
  ('931cee76-e9bc-43d6-a70e-d0b0f73c4c17', '76769ac1-201f-4b4e-a845-4558d6e2c9c4', 'Sona Masoori Rice 5kg', 'Premium aged rice.', 'staples', 'items', 420, 480, '5 kg', 24, 'veg', 'approved', true, true, 4.3, 86),
  ('1e45a600-9184-4100-ac87-f1af78c24c14', '76769ac1-201f-4b4e-a845-4558d6e2c9c4', 'Toor Dal 1kg', 'Unpolished split pigeon peas.', 'staples', 'items', 160, 185, '1 kg', 40, 'veg', 'approved', true, true, 4.4, 52),
  ('b1f71027-0b64-422e-accf-a937224885eb', '76769ac1-201f-4b4e-a845-4558d6e2c9c4', 'Sunflower Oil 1L', 'Refined cooking oil pouch.', 'staples', 'items', 140, 165, '1 L', 36, 'veg', 'approved', true, true, 4.1, 41),
  ('a32cef9d-1f76-4094-afa3-35df1bc0121e', '76769ac1-201f-4b4e-a845-4558d6e2c9c4', 'Detergent Powder 1kg', 'For machine and hand wash.', 'household', 'items', 110, 130, '1 kg', 28, '', 'approved', true, true, 4, 33),
  ('24de8c83-eab3-4d6d-aa83-81f0c4b56243', '88077c27-81ff-415e-a32d-c4b5ab0c64c6', 'Tomatoes 1kg', 'Firm, ripe and locally grown.', 'vegetables', 'items', 40, 55, '1 kg', 70, 'veg', 'approved', true, true, 4.2, 64),
  ('3bdab6b1-d9c7-4faf-a0cf-413c2bbca89a', '88077c27-81ff-415e-a32d-c4b5ab0c64c6', 'Onions 2kg', 'Medium size, good for daily cooking.', 'vegetables', 'items', 76, 90, '2 kg', 55, 'veg', 'approved', true, true, 4.3, 71),
  ('9a3c9379-0df7-400d-aaa8-904e1adf82e2', '88077c27-81ff-415e-a32d-c4b5ab0c64c6', 'Banana (dozen)', 'Yelakki variety, naturally ripened.', 'fruits', 'items', 60, 72, '12 pcs', 48, 'veg', 'approved', true, true, 4.5, 112),
  ('7a9a3e68-f87b-48df-a84c-5f5fc06e6e5a', '88077c27-81ff-415e-a32d-c4b5ab0c64c6', 'Shimla Apples 1kg', 'Crisp and sweet.', 'fruits', 'items', 180, 220, '1 kg', 30, 'veg', 'approved', true, true, 4.4, 58)
on conflict (id) do update set price = excluded.price, mrp = excluded.mrp, stock = excluded.stock, approval_status = 'approved';
