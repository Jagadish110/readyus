-- Localty 0022: payments move from Razorpay to Cashfree.
--
-- A new enum value cannot be used in the same transaction that adds it, so this
-- migration only adds the value. The rest of the change is in 0023.

alter type public.payment_provider add value if not exists 'cashfree';
