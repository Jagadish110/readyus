-- ReadyUs 0020: shops no longer have a time limit to accept an order.
--
-- Orders now wait for the shop until it answers, or until the customer cancels
-- (cancel_order still allows that while the order is pending). The sweep that
-- cancelled unanswered orders and returned their stock is removed; nothing else
-- calls it. Old orders that already ended as 'timed_out' keep that status.

drop function if exists public.expire_stale_orders();
