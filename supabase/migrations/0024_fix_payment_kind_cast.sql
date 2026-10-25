-- Localty 0024: fix "column kind is of type payment_kind but expression is of type text".
--
-- claim_payment (the manual UPI "I have paid" button) and mark_order_paid (online payments)
-- both insert a payment whose kind comes from a CASE over two string literals. Postgres types
-- that CASE as plain text, which cannot go into the payment_kind column, so both functions
-- failed every time they ran. The fix is an explicit cast.
--
-- The functions are rewritten from their own current definitions, so nothing else in them
-- can drift, and their permissions are untouched. Safe to run more than once.
do $$
declare
  v_def  text;
  v_sig  text;
  v_old  constant text := 'case when v_order.payment_mode = ''full_prepaid'' then ''full_online'' else ''cod_prepayment'' end,';
  v_new  constant text := '(case when v_order.payment_mode = ''full_prepaid'' then ''full_online'' else ''cod_prepayment'' end)::payment_kind,';
begin
  foreach v_sig in array array['public.claim_payment(uuid, text)', 'public.mark_order_paid(text, text, integer)']
  loop
    select pg_get_functiondef(v_sig::regprocedure) into v_def;
    if position(v_old in v_def) > 0 then
      execute replace(v_def, v_old, v_new);
    end if;
  end loop;
end $$;
