import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { Eyebrow } from '@/components/ui/card';
import { ApprovalsBoard, type PendingProduct, type PendingSeller } from '@/components/admin/approvals-board';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

/**
 * PostgREST returns a geography column as hex EWKB. This reads the point out of
 * it (with or without SRID) so the page can show a plain lat/lng.
 */
function readPoint(hex: string | null): { lat: number; lng: number } | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  if (bytes.length < 21) return null;
  const view = new DataView(bytes.buffer);
  const little = bytes[0] === 1;
  const type = view.getUint32(1, little);
  const offset = (type & 0x20000000) !== 0 ? 9 : 5;
  if (bytes.length < offset + 16) return null;
  const lng = view.getFloat64(offset, little);
  const lat = view.getFloat64(offset + 8, little);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

type SellerRow = Omit<PendingSeller, 'pin'> & { location: string | null };

export default async function ApprovalsPage() {
  const supabase = await createClient();

  // The checked-in Database type does not describe tables to supabase-js yet,
  // so the two reads are typed here. RLS (is_admin) lets an admin see all rows.
  type Query = {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, opts: { ascending: boolean }) => PromiseLike<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const db = supabase as unknown as { from: (table: string) => Query };

  const [sellersResult, productsResult] = await Promise.all([
    db
      .from('sellers')
      .select('id, shop_name, owner_name, phone, category, listing_mode, address, city, pincode, location, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    db
      .from('products')
      .select('id, name, price, unit, category_key, listing_mode, created_at, sellers(shop_name)')
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: false })
  ]);

  const sellers: PendingSeller[] = ((sellersResult.data as SellerRow[] | null) ?? []).map(
    ({ location, ...rest }) => ({ ...rest, pin: readPoint(location) })
  );
  const products = (productsResult.data as PendingProduct[] | null) ?? [];
  const loadError = sellersResult.error?.message ?? productsResult.error?.message ?? '';

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
          Approvals
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Shops and products wait here until you approve them. Nothing is visible to customers before then.
        </p>
      </div>

      {loadError && (
        <p
          role="alert"
          className="rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-semibold text-[var(--text)] ring-1 ring-danger/35"
        >
          Could not load applications: {loadError}
        </p>
      )}

      <ApprovalsBoard sellers={sellers} products={products} />
    </div>
  );
}
