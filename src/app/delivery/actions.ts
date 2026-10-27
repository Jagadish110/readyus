'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signOutRider() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/delivery/login');
}
