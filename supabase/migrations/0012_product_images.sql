-- ReadyUs 0012: product photos.
--
-- A public bucket: the files are menu photos meant for customers, so reads need
-- no policy and go through the CDN. Writes are limited to the owner's own
-- folder, `<seller_id>/<file>`, so one shop cannot overwrite another's photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy product_images_seller_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_seller_id()::text
  );

create policy product_images_seller_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_seller_id()::text
  );

create policy product_images_seller_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_seller_id()::text
  );
