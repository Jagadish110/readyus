import { api } from './client';

export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads a photo for the signed-in seller's shop. The backend chooses the path
 * and returns a one-time link; the file then goes straight to storage, so the
 * browser never holds a storage key or picks where a file lands.
 */
export async function uploadShopImage(kind: 'product' | 'shop', file: File): Promise<UploadResult> {
  if (!IMAGE_TYPES[file.type]) return { ok: false, error: 'Photos must be JPG, PNG or WebP.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Each photo must be under 5 MB.' };

  const link = await api<{ uploadUrl: string; publicUrl: string }>('POST', '/v1/seller/uploads', {
    kind,
    contentType: file.type
  });
  if (!link.ok) return { ok: false, error: link.error };

  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);

  try {
    const response = await fetch(link.data.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
    if (!response.ok) return { ok: false, error: 'The photo could not be uploaded. Please try again.' };
  } catch {
    return { ok: false, error: 'The photo could not be uploaded. Check your connection.' };
  }
  return { ok: true, url: link.data.publicUrl };
}
