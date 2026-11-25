'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { uploadShopImage } from '@/lib/api/upload';
import type { ShopRow } from '@/lib/business/db';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NoPhoto } from '@/components/marketplace/no-photo';
import { cn } from '@/lib/utils';

type Slot = 'banner' | 'photo';

/**
 * The shop's two pictures: the wide banner on its card and shop page, and the round profile icon.
 * Each is changed on its own. Until one is uploaded, the other stands in for it, as customers see.
 */
export function ShopPhotos({ shop }: { shop: ShopRow }) {
  const router = useRouter();
  const [urls, setUrls] = useState({ banner: shop.banner_url ?? null, photo: shop.photo_url ?? null });
  const [busy, setBusy] = useState<Slot | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const inputs = { banner: useRef<HTMLInputElement>(null), photo: useRef<HTMLInputElement>(null) };

  async function change(slot: Slot, file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setBusy(slot);
    const uploaded = await uploadShopImage('shop', file);
    if (!uploaded.ok) {
      setBusy(null);
      return setMessage({ tone: 'error', text: uploaded.error });
    }
    const saved = await api('POST', '/v1/seller/shop/photo', { url: uploaded.url, slot });
    setBusy(null);
    if (!saved.ok) return setMessage({ tone: 'error', text: saved.error });
    setUrls((current) => ({ ...current, [slot]: uploaded.url }));
    setMessage({ tone: 'ok', text: slot === 'banner' ? 'Banner updated.' : 'Profile photo updated.' });
    router.refresh();
  }

  const banner = urls.banner || urls.photo;
  const photo = urls.photo || urls.banner;

  function picker(slot: Slot) {
    return (
      <input
        ref={inputs[slot]}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          void change(slot, event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    );
  }

  return (
    <Card className="grid gap-5 p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Shop photos</h2>
        <p className="text-sm text-[var(--text-muted)]">
          What customers see on your shop card and shop page. JPG, PNG or WebP, under 5 MB.
        </p>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-bold">Banner</span>
        <div className="tile relative aspect-[16/7] w-full overflow-hidden rounded-[20px] bg-[var(--tile)] ring-1 ring-[var(--line)]">
          {banner ? (
            <Image src={banner} alt="Your shop banner" fill sizes="(max-width: 768px) 92vw, 640px" className="object-cover" />
          ) : (
            <NoPhoto name={shop.shop_name} />
          )}
          {busy === 'banner' && <Uploading />}
        </div>
        <span className="text-xs font-medium text-[var(--text-muted)]">
          {urls.banner ? 'A wide photo works best, like your shop front or a spread of dishes.' : 'No banner yet, so customers see your profile photo here.'}
        </span>
        {picker('banner')}
        <Button
          type="button"
          variant="leaf-outline"
          size="sm"
          className="justify-self-start"
          disabled={busy !== null}
          onClick={() => inputs.banner.current?.click()}
        >
          {urls.banner ? 'Change banner' : 'Add banner'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="tile relative block size-24 shrink-0 overflow-hidden rounded-[22px] bg-[var(--tile)] ring-1 ring-[var(--line)]">
          {photo ? (
            <Image src={photo} alt="Your shop profile photo" fill sizes="96px" className="object-cover" />
          ) : (
            <NoPhoto name={shop.shop_name} />
          )}
          {busy === 'photo' && <Uploading />}
        </span>
        <span className="grid min-w-0 flex-1 gap-2">
          <span className="text-sm font-bold">Profile photo</span>
          <span className="text-xs font-medium text-[var(--text-muted)]">Your logo or a square photo. It sits on your shop page.</span>
          {picker('photo')}
          <Button
            type="button"
            variant="leaf-outline"
            size="sm"
            className="justify-self-start"
            disabled={busy !== null}
            onClick={() => inputs.photo.current?.click()}
          >
            {urls.photo ? 'Change profile photo' : 'Add profile photo'}
          </Button>
        </span>
      </div>

      {message && (
        <p role="status" className={cn('text-sm font-semibold', message.tone === 'ok' ? 'text-[var(--leaf-ink)]' : 'text-danger')}>
          {message.text}
        </p>
      )}
    </Card>
  );
}

function Uploading() {
  return (
    <span className="absolute inset-0 grid place-items-center bg-ink-900/45 text-sm font-bold text-white">Uploading…</span>
  );
}
