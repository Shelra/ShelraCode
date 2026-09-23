import { SQL } from "bun";

/*
 * Postgres through Bun's built-in client. Every value interpolated into a sql`...` template is sent as a
 * bound parameter, never spliced into the text, so queries written that way cannot be injected.
 */
export function openDatabase(url: string): SQL {
  // One small instance needs few connections, and the Supabase pooler caps clients per project.
  return new SQL({ url, max: 5, idleTimeout: 60, connectionTimeout: 10 });
}

/**
 * Runs `work` in a transaction on behalf of the person `userId`. The transaction switches to Supabase's
 * `authenticated` role with that id in the JWT claim settings that `auth.uid()` reads (what PostgREST sets
 * for a signed-in request), so the tables' row-level-security policies, not only the query text, decide
 * which rows the work can read or change. Every setting ends with the transaction.
 */
export async function asUser<T>(sql: SQL, userId: string, work: (tx: SQL) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return work(tx);
  })) as T;
}
