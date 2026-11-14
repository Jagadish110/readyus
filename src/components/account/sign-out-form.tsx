'use client';

import { forgetSavedLocation } from '@/lib/state/location';
import { Button } from '@/components/ui/button';

/** Signs out and forgets the saved delivery place, so the next account on this phone does not inherit it. */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={forgetSavedLocation} className="animate-rise [animation-delay:160ms]">
      <Button type="submit" variant="outline" size="lg" fullWidth>
        Sign out
      </Button>
    </form>
  );
}
