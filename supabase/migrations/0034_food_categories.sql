-- ReadyUs 0034: the everyday food categories sellers list under and customers filter by.
-- Safe to re-run: existing keys keep their place and only get the new display name.
insert into public.categories (mode, key, name, sort) values
  ('food', 'biryani',   'Biryani',       0),
  ('food', 'meals',     'Meals',         1),
  ('food', 'tiffins',   'Tiffins',       2),
  ('food', 'chicken',   'Chicken',       3),
  ('food', 'mutton',    'Mutton',        4),
  ('food', 'seafood',   'Fish & Prawns', 5),
  ('food', 'curries',   'Curries',       6),
  ('food', 'chinese',   'Chinese',       7),
  ('food', 'rolls',     'Rolls & Wraps', 8),
  ('food', 'snacks',    'Snacks',        9),
  ('food', 'kebabs',    'Kebabs',        10),
  ('food', 'desserts',  'Sweets',        11),
  ('food', 'bakery',    'Bakery',        12),
  ('food', 'beverages', 'Chai & Drinks', 13)
on conflict (mode, key) do update set name = excluded.name, sort = excluded.sort;
