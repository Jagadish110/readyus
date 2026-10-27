'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Admin = { user_id: string; email: string | null; full_name: string; granted_at: string };

const ERRORS: Record<string, string> = {
  ACCOUNT_NOT_FOUND: 'No active account has that email. They need to sign up first.',
  CANNOT_REMOVE_SELF: 'You cannot remove yourself. Ask another admin to do it.',
  NOT_AN_ADMIN: 'That person is not an admin any more.'
};

export function AdminsList() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api<{ admins: Admin[] }>('GET', '/v1/admin/admins');
    if (result.ok) setAdmins(result.data.admins);
    else setError(result.status === 403 ? 'This page is for admins only.' : result.error);
  }, []);
  useEffect(() => void load(), [load]);

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    const result = await api('POST', path, body ?? {});
    setBusy(false);
    if (!result.ok) return setError(ERRORS[result.code ?? ''] ?? result.error);
    await load();
  }

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await call('/v1/admin/admins', { email });
          setEmail('');
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email of an existing account"
          aria-label="Email to make an admin"
          className="h-12 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 text-sm"
        />
        <Button type="submit" variant="leaf" loading={busy}>Make admin</Button>
      </form>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {admins?.map((admin) => (
        <Card key={admin.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-bold">{admin.full_name || admin.email}</p>
            <p className="text-sm text-[var(--text-muted)]">{admin.email}</p>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/v1/admin/admins/${admin.user_id}/remove`)}>
            Remove
          </Button>
        </Card>
      ))}
    </div>
  );
}
