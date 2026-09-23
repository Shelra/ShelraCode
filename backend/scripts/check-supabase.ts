import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

/*
 * End-to-end check against the real Supabase project named in backend/.env: the migrated database, Supabase
 * Auth, this API started as its real entry point, and the real `shelra` CLI. It uses a throwaway account
 * (created and deleted with the Auth admin API, so SUPABASE_SECRET_KEY is needed here and only here) and
 * prints each step; it never prints a key, a password or a token. Run from backend/ after `bun run db:push`:
 *
 *   bun run check:supabase                         everything except the email itself
 *   bun run check:supabase --login-email <address> also runs `shelra login`, which emails that address a code;
 *                                                  Supabase's built-in email only reaches the project's team
 */
const BACKEND = join(import.meta.dir, "..");
const CLI = join(BACKEND, "..", "src", "index.ts");

const config = loadConfig();
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
if (!secretKey.startsWith("sb_secret_")) fail("SUPABASE_SECRET_KEY (sb_secret_...) is needed for this check");
const loginEmailFlag = process.argv.indexOf("--login-email");
const loginEmail = loginEmailFlag > 0 ? process.argv[loginEmailFlag + 1]?.toLowerCase() : undefined;

const scratch = mkdtempSync(join(tmpdir(), "shelra-check-"));
const home = join(scratch, "home");
mkdirSync(home);
let api: ReturnType<typeof Bun.spawn> | undefined;
let userId: string | undefined;

function fail(message: string): never {
  throw new Error(message);
}
function step(message: string): void {
  console.log(`ok  ${message}`);
}

async function supabase(path: string, init: { method?: string; key: string; bearer?: string; body?: unknown }) {
  const headers: Record<string, string> = { apikey: init.key };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

/** A fresh one-time code for `email`, straight from the admin API (no email is sent). */
async function adminCode(email: string): Promise<string> {
  const link = await supabase("/auth/v1/admin/generate_link", {
    method: "POST",
    key: secretKey,
    body: { type: "magiclink", email },
  });
  const properties = link.body.properties as Record<string, unknown> | undefined;
  const code = link.body.email_otp ?? properties?.email_otp;
  if (link.status !== 200 || typeof code !== "string") fail(`generate_link answered ${link.status}`);
  return code;
}

async function cli(args: string[], stdin?: string) {
  const child = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: scratch,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

async function startApi(): Promise<string> {
  const child = Bun.spawn(["bun", "src/index.ts"], {
    cwd: BACKEND,
    env: { ...process.env, PORT: "0" },
    stdout: "pipe",
    stderr: "inherit",
  });
  api = child;
  const reader = child.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) fail("the API exited before listening (its log is above)");
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const first = JSON.parse(text.slice(0, text.indexOf("\n"))) as { msg: string; url?: string };
  if (first.msg !== "listening" || !first.url) fail(`the API did not start: ${first.msg}`);
  return first.url.replace(/\/$/, "");
}

async function run(): Promise<void> {
  const base = await startApi();
  step(`API started against the project's database (${base})`);

  const email = loginEmail ?? `shelra-check-${crypto.randomUUID().slice(0, 8)}@example.com`;
  let token: string;
  if (loginEmail) {
    // The real `shelra login`: it emails a code; a fresh admin code replaces it and is typed into the CLI.
    const child = Bun.spawn(["bun", "run", CLI, "login", "--api-url", base, "--email", email, "--name", "check"], {
      cwd: scratch,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const errors = child.stderr.getReader();
    let prompt = "";
    while (!prompt.includes("Code:")) {
      const { value, done } = await errors.read();
      if (done) fail(`shelra login stopped before asking for the code: ${prompt.trim()}`);
      prompt += new TextDecoder().decode(value);
    }
    child.stdin.write(`${await adminCode(email)}\n`);
    await child.stdin.end();
    const out = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) fail(`shelra login failed: ${out.trim()}`);
    step("shelra login: Supabase sent the code email, the code was verified, a device token was stored");
    const stored = JSON.parse(await Bun.file(join(home, ".shelra", "auth.json")).text());
    token = stored.account.token;
    const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    userId = ((await me.json()) as { account: { id: string } }).account.id;
  } else {
    const created = await supabase("/auth/v1/admin/users", {
      method: "POST",
      key: secretKey,
      body: { email, email_confirm: true },
    });
    if (created.status !== 200 || typeof created.body.id !== "string") fail(`create user answered ${created.status}`);
    userId = created.body.id;
    step("throwaway account created with the Auth admin API");

    // The requests `shelra login` makes after the email: verify the code, then trade the session for a token.
    const verified = await supabase("/auth/v1/verify", {
      method: "POST",
      key: config.supabasePublishableKey,
      body: { type: "email", email, token: await adminCode(email) },
    });
    const session = verified.body.access_token;
    if (verified.status !== 200 || typeof session !== "string") fail(`verify answered ${verified.status}`);
    step("one-time code verified by Supabase Auth with the publishable key");

    const direct = await supabase("/rest/v1/access_tokens?select=id", {
      key: config.supabasePublishableKey,
      bearer: session,
    });
    const viaProfile = await fetch(`${config.supabaseUrl}/rest/v1/access_tokens?select=id`, {
      headers: {
        apikey: config.supabasePublishableKey,
        authorization: `Bearer ${session}`,
        "accept-profile": "shelra",
      },
    });
    if (direct.status < 400 || viaProfile.status < 400) fail("the Data API can reach shelra.access_tokens");
    step(`the Data API cannot reach the shelra schema (answers ${direct.status} and ${viaProfile.status})`);

    const issued = await fetch(`${base}/v1/tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "check" }),
    });
    if (issued.status !== 201) fail(`POST /v1/tokens answered ${issued.status}: ${await issued.text()}`);
    const body = (await issued.json()) as { id: string; token: string };
    token = body.token;
    step("API verified the real session and stored a device token as the authenticated role (RLS)");
    await supabase("/auth/v1/logout?scope=local", {
      method: "POST",
      key: config.supabasePublishableKey,
      bearer: session,
    });
    // What `shelra login` would have stored on this machine.
    mkdirSync(join(home, ".shelra"), { recursive: true });
    const account = { apiUrl: base, token, tokenId: body.id, email };
    writeFileSync(join(home, ".shelra", "auth.json"), JSON.stringify({ account }));
  }

  const whoami = await cli(["whoami"]);
  if (whoami.code !== 0 || !whoami.out.includes(email)) fail(`shelra whoami failed: ${whoami.err || whoami.out}`);
  step("shelra whoami: the API resolved the token and read the account from auth.users");

  const logout = await cli(["logout"]);
  if (logout.code !== 0) fail(`shelra logout failed: ${logout.err || logout.out}`);
  const after = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  if (after.status !== 401) fail(`a revoked token answered ${after.status}`);
  step("shelra logout: the token was revoked on the server and is refused afterwards");
}

try {
  await run();
  console.log("\nThe real-project check passed.");
} catch (error) {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (userId && !loginEmail) {
    const removed = await supabase(`/auth/v1/admin/users/${userId}`, { method: "DELETE", key: secretKey });
    console.log(removed.status === 200 ? "ok  throwaway account deleted" : `!!  delete answered ${removed.status}`);
  }
  api?.kill();
  rmSync(scratch, { recursive: true, force: true });
}
