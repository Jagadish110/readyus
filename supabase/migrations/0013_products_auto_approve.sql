-- Menu items go live as soon as an approved shop adds them. The shop itself is
-- still reviewed, and an admin can reject an item afterwards (review_product).
alter table public.products alter column approval_status set default 'approved';
update public.products set approval_status = 'approved', public_visible = true where approval_status = 'pending';
