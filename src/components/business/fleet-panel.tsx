'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ordersDb, rows } from '@/lib/orders/db';
import { Button } from '@/components/ui/button';

type Partner = { id: string; agent: { full_name: string; phone: string; vehicle: string } | null };
type Invite = { id: string; code: string; expires_at: string; used_at: string | null };

// No I, O, 0 or 1, so a code read aloud is hard to mistake.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** The shop's own delivery team: partners join with a short code the shop hands out. */
export function FleetPanel({ shopId }: { shopId: string }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const db = ordersDb(supabase);
    const [team, codes] = await Promise.all([
      db
        .from('delivery_relationships')
        .select('id, agent:delivery_agents(full_name, phone, vehicle)')
        .eq('seller_id', shopId)
        .eq('active', 'true'),
      db
        .from('delivery_invites')
        .select('id, code, expires_at, used_at')
        .eq('seller_id', shopId)
        .order('created_at', { ascending: false })
        .limit(10)
    ]);
    setPartners(rows<Partner>(team));
    setInvites(rows<Invite>(codes));
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const result = await ordersDb(supabase)
      .from('delivery_invites')
      .insert({
        seller_id: shopId,
        code: newCode(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    setBusy(false);
    if (result.error) setError('Could not create a code. Please try again.');
    await load();
  }

  const open = invites.filter((invite) => !invite.used_at && new Date(invite.expires_at) > new Date());

  return (
    <section className="grid gap-4 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
      <div>
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Your delivery team</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Riders take orders only from shops whose team they joined. Give a rider a code; they enter it at{' '}
          <span className="font-bold">/delivery</span>. Each code works once and lasts a week.
        </p>
      </div>

      {partners.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No riders yet.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {partners.map((partner) => (
            <li key={partner.id} className="flex flex-wrap justify-between gap-2 rounded-[16px] bg-[var(--tile)] px-4 py-2.5">
              <span className="font-bold">{partner.agent?.full_name}</span>
              <span className="text-[var(--text-muted)]">
                {partner.agent?.vehicle} &middot; {partner.agent?.phone}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {open.map((invite) => (
            <li
              key={invite.id}
              className="rounded-full bg-[var(--leaf-soft)] px-4 py-2 font-display text-base font-extrabold tracking-[0.2em] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]"
            >
              {invite.code}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

      <Button variant="leaf-outline" size="sm" className="justify-self-start" onClick={create} loading={busy}>
        New rider code
      </Button>
    </section>
  );
}
