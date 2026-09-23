import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asUser } from "../src/db";
import { generateToken, hashToken } from "../src/tokens";
import { alice, bob, startDatabase } from "./harness";

/*
 * The database's own guarantees, independent of the API's query text: what the migration lets each
 * Supabase role do, and what row-level security leaves visible to a person.
 */
let database: Awaited<ReturnType<typeof startDatabase>>;
let bobsToken = "";

beforeAll(async () => {
  database = await startDatabase();
  for (const person of [alice, bob]) {
    const token = generateToken();
    const [row] = await database.sql`
      insert into shelra.access_tokens (user_id, name, token_prefix, token_hash)
      values (${person.id}, 'seed', ${token.slice(0, 12)}, ${hashToken(token)}) returning id`;
    if (person === bob) bobsToken = row.id;
  }
});

afterAll(async () => {
  await database.stop();
});

describe("row-level security for a person's work", () => {
  test("a query without any user filter sees only the person's own tokens", async () => {
    const rows = await asUser(database.sql, alice.id, (tx) => tx`select user_id from shelra.access_tokens`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: { user_id: string }) => row.user_id === alice.id)).toBe(true);
  });

  test("changing the id does not reach someone else's token", async () => {
    const deleted = await asUser(
      database.sql,
      alice.id,
      (tx) => tx`delete from shelra.access_tokens where id = ${bobsToken} returning id`,
    );
    expect(deleted.length).toBe(0);
    const still = await database.sql`select id from shelra.access_tokens where id = ${bobsToken}`;
    expect(still.length).toBe(1);
  });

  test("a person cannot create a token for someone else", async () => {
    const token = generateToken();
    const attempt = asUser(
      database.sql,
      alice.id,
      (tx) => tx`
        insert into shelra.access_tokens (user_id, name, token_prefix, token_hash)
        values (${bob.id}, 'forged', ${token.slice(0, 12)}, ${hashToken(token)})`,
    );
    await expect(attempt).rejects.toThrow(/row-level security/);
  });

  test("a person's work can never change a token, not even their own", async () => {
    const attempt = asUser(
      database.sql,
      alice.id,
      (tx) => tx`update shelra.access_tokens set token_hash = ${hashToken("x")} where user_id = ${alice.id}`,
    );
    await expect(attempt).rejects.toThrow(/permission denied/);
  });

  test("the role and claims end with the transaction", async () => {
    await asUser(database.sql, alice.id, (tx) => tx`select 1`);
    const [row] = await database.sql`
      select current_user as role, current_setting('request.jwt.claims', true) as claims`;
    expect(row.role).toBe("postgres");
    expect(row.claims ?? "").toBe("");
  });
});

describe("what the Data API roles can reach", () => {
  test("anon and service_role cannot use the shelra schema", async () => {
    const [row] = await database.sql`
      select has_schema_privilege('anon', 'shelra', 'usage') as anon,
             has_schema_privilege('service_role', 'shelra', 'usage') as service_role`;
    expect(row).toEqual({ anon: false, service_role: false });
  });

  test("authenticated may read, create and delete tokens, and never update one", async () => {
    const [row] = await database.sql`
      select has_table_privilege('authenticated', 'shelra.access_tokens', 'select') as read,
             has_table_privilege('authenticated', 'shelra.access_tokens', 'insert') as create,
             has_table_privilege('authenticated', 'shelra.access_tokens', 'delete') as delete,
             has_table_privilege('authenticated', 'shelra.access_tokens', 'update') as update`;
    expect(row).toEqual({ read: true, create: true, delete: true, update: false });
  });

  test("anon is refused outright", async () => {
    const attempt = database.sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select * from shelra.access_tokens`;
    });
    await expect(attempt).rejects.toThrow(/permission denied/);
  });
});
