'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/** Download everything we hold, or erase the account. Both act on the signed-in person only. */
export function DataControls() {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState('');

  async function download() {
    setBusy('export');
    setError('');
    const result = await api<unknown>('GET', '/v1/account/export');
    setBusy('');
    if (!result.ok) return setError(result.error);
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'my-localty-data.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function erase() {
    setBusy('delete');
    setError('');
    const result = await api('POST', '/v1/account/delete', { confirm: 'DELETE' });
    if (!result.ok) {
      setBusy('');
      return setError(result.error);
    }
    await createClient()?.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <section className="animate-rise grid gap-3 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
      <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Your data</h2>
      <p className="text-sm text-[var(--text-muted)]">Take a copy of what Localty holds about you, or erase your account. Erasing removes your name, phone, email, addresses and saved items. Past orders stay, without anything that says who you are.</p>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2.5">
        <Button size="sm" variant="leaf-outline" loading={busy === 'export'} onClick={download}>
          Download my data
        </Button>
        {!confirming && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        )}
      </div>
      {confirming && (
        <div className="grid gap-2 rounded-[18px] bg-danger/10 p-3.5 ring-1 ring-danger/30">
          <p className="text-sm font-bold">This cannot be undone. Type DELETE to confirm.</p>
          <div className="flex flex-wrap gap-2">
            <input value={word} onChange={(event) => setWord(event.target.value)} aria-label="Type DELETE to confirm" autoCapitalize="characters" className="h-11 w-40 rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none focus:border-danger" />
            <Button size="sm" variant="danger" disabled={word !== 'DELETE'} loading={busy === 'delete'} onClick={erase}>
              Erase my account
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(false); setWord(''); }}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
