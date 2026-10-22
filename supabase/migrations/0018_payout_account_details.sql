-- ReadyUs 0018: shops add their own bank details; ReadyUs creates the Razorpay
-- linked account from them.
--
-- The full bank account number and PAN are sent straight to Razorpay and never
-- stored here. We keep only what the shop needs to recognise the account.

alter table public.seller_payout_accounts
  add column if not exists razorpay_product_id text,
  -- Accounts an admin registers by hand count as ready; accounts a shop creates
  -- start at 'created' and become 'activated' once Razorpay approves them.
  add column if not exists status text not null default 'activated',
  add column if not exists status_detail text not null default '',
  add column if not exists business_type text,
  add column if not exists beneficiary_name text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_last4 text;
