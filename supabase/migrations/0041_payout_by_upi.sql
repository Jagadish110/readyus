-- Localty 0041: a shop can be paid out to its UPI ID instead of a bank account.
--
-- Cashfree Easy Split takes either a bank account or a UPI ID (VPA) for each vendor, never both, and checks
-- it before the vendor goes live. Many small shops know their UPI ID but not their IFSC, so they may give
-- that instead. The money still lands in the bank account behind the UPI ID.
--
-- As with bank accounts, the full UPI ID goes to Cashfree and is not kept here: only a masked form the
-- owner can recognise, like "pi•••@okhdfcbank".

alter table public.seller_payout_accounts
  add column if not exists payout_method text not null default 'bank',
  add column if not exists upi_display text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seller_payout_accounts_payout_method_check') then
    alter table public.seller_payout_accounts
      add constraint seller_payout_accounts_payout_method_check check (payout_method in ('bank', 'upi'));
  end if;
end $$;
