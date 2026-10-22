import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Service-role client. It bypasses row level security, so it only ever runs
 * inside this service and every caller is authenticated and authorised first.
 */
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
