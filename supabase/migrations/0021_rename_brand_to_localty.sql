-- ReadyUs -> Localty: the app's brand name changed.
--
-- The only brand text stored in the database is the notification an admin gets when a
-- shop applies. Redefine apply_to_sell with the new name by rewriting its own
-- definition, so nothing else in the function can drift.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.apply_to_sell(text, text, text, text, listing_mode, text, text, text)'::regprocedure
  ) into v_def;

  if v_def like '%applied to sell on ReadyUs.%' then
    execute replace(v_def, 'applied to sell on ReadyUs.', 'applied to sell on Localty.');
  end if;
end $$;
