'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

/** A searchable list fetched from the backend. Typing waits a moment before it asks again. */
export function useDirectory<T>(path: string, key: string, extra = '') {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Record<string, T[]>>('GET', `${path}?q=${encodeURIComponent(term)}${extra}`);
    if (result.ok) {
      setRows(result.data[key]);
      setError('');
    } else {
      setError(result.status === 403 ? 'This page is for admins only.' : result.error);
    }
  }, [path, key, term, extra]);

  useEffect(() => {
    const timer = setTimeout(load, term ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, term]);

  return { term, setTerm, rows, error, reload: load };
}
