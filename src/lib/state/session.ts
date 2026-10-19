'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Whether someone is signed in: `null` while the browser session loads, so
 * callers can avoid flashing the wrong call to action.
 */
export function useSignedIn() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setSignedIn(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setSignedIn(Boolean(session?.user))
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  return signedIn;
}
