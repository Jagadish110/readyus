/**
 * The checked-in Database type does not describe tables to supabase-js yet, so
 * the order, delivery and rider screens talk to it through this minimal local
 * shape (same approach as the account page and lib/business/db.ts). It works
 * with both the browser client and the server client.
 */
export type DbError = { message: string } | null;
export type Outcome = { data: unknown; error: DbError };

export type Query = PromiseLike<Outcome> & {
  select: (columns?: string) => Query;
  insert: (values: Record<string, unknown> | Array<Record<string, unknown>>) => Query;
  update: (values: Record<string, unknown>) => Query;
  delete: () => Query;
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  order: (column: string, opts: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Query;
};

export type Db = {
  from: (table: string) => Query;
  rpc: (name: string, args?: Record<string, unknown>) => Query;
};

export const ordersDb = (client: object) => client as unknown as Db;

export function rows<T>(result: Outcome): T[] {
  return Array.isArray(result.data) ? (result.data as T[]) : [];
}

export function row<T>(result: Outcome): T | null {
  const data = result.data;
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);
