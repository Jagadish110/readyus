-- Localty 0044: the master food category list sellers pick from.
-- The earlier everyday categories (biryani, meals, ...) stop being offered to sellers but stay in the table,
-- so dishes already listed under them keep their name and customers still find them.
-- Safe to re-run.
update public.categories set enabled = false where mode = 'food';

insert into public.categories (mode, key, name, sort, enabled) values
  ('food', 'indian-main-course',     'Indian Main Course',        0, true),
  ('food', 'rice-biryani',           'Rice & Biryani',            1, true),
  ('food', 'indian-street-food',     'Indian Street Food',        2, true),
  ('food', 'snacks-savouries',       'Snacks & Savouries',        3, true),
  ('food', 'breads-parathas',        'Breads & Parathas',         4, true),
  ('food', 'south-indian-food',      'South Indian Food',         5, true),
  ('food', 'breakfast',              'Breakfast',                 6, true),
  ('food', 'fast-food',              'Fast Food',                 7, true),
  ('food', 'chinese-asian-food',     'Chinese & Asian Food',      8, true),
  ('food', 'chicken-meat-seafood',   'Chicken, Meat & Seafood',   9, true),
  ('food', 'pasta-international',    'Pasta & International Food', 10, true),
  ('food', 'bakery-bread-products',  'Bakery & Bread Products',   11, true),
  ('food', 'sweets-desserts-master', 'Sweets & Desserts',         12, true),
  ('food', 'beverages-master',       'Beverages',                 13, true),
  ('food', 'healthy-food',           'Healthy Food',              14, true),
  ('food', 'special-diet-food',      'Special Diet Food',         15, true),
  ('food', 'thali-meal-combos',      'Thali & Meal Combos',       16, true),
  ('food', 'tiffin-homemade-meals',  'Tiffin & Homemade Meals',   17, true),
  ('food', 'soup-salad',             'Soup & Salad',              18, true),
  ('food', 'appetizers-starters',    'Appetizers & Starters',     19, true),
  ('food', 'side-dishes',            'Side Dishes',               20, true),
  ('food', 'dips-sauces-chutneys',   'Dips, Sauces & Chutneys',   21, true),
  ('food', 'ready-to-eat-frozen',    'Ready-to-Eat & Frozen Food', 22, true)
on conflict (mode, key) do update set name = excluded.name, sort = excluded.sort, enabled = true;
