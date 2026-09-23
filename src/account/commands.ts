import { hostname } from "node:os";
import readline from "node:readline";
import { CLI_NAME } from "../product/identity";
import { clearAccount, getStoredAccount, type StoredAccount, saveAccount } from "../security/credentials";
import {
  AccountError,
  createDeviceToken,
  getAuthConfig,
  getMe,
  normalizeAccountUrl,
  revokeDeviceToken,
} from "./client";
import { type EmailSession, sendEmailCode, signOutSession, verifyEmailCode } from "./email-code";

/*
 * `shelra login`, `whoami` and `logout`. Login signs in with a code sent by email (no browser, so it works
 * over SSH), exchanges that short-lived session for a device token named after this machine, and keeps
 * only the token in ~/.shelra/auth.json. The token can be revoked on its own, from here or the dashboard.
 */
type FetchLike = typeof fetch;

/** How the commands talk to the person. `ask` resolves null when the input has ended. */
export type AccountIO = {
  ask(question: string): Promise<string | null>;
  say(line: string): void;
  warn(line: string): void;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_ATTEMPTS = 3;

export function defaultDeviceName(): string {
  return `${CLI_NAME} on ${hostname()}`.slice(0, 64);
}

export async function login(options: {
  apiUrl: string;
  email?: string;
  deviceName?: string;
  io: AccountIO;
  fetchImpl?: FetchLike;
}): Promise<StoredAccount> {
  const { io } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeAccountUrl(options.apiUrl);
  const config = await getAuthConfig(apiUrl, fetchImpl);
  const email = (options.email ?? (await io.ask("Email: ")) ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AccountError(`"${email}" is not an email address.`);

  await sendEmailCode(config, email, fetchImpl);
  io.say(`A sign-in code was sent to ${email}.`);
  const session = await askForCode(email, io, (code) => verifyEmailCode(config, email, code, fetchImpl));

  let issued: Awaited<ReturnType<typeof createDeviceToken>>;
  try {
    issued = await createDeviceToken(apiUrl, session.accessToken, options.deviceName ?? defaultDeviceName(), fetchImpl);
  } finally {
    await signOutSession(config, session.accessToken, fetchImpl);
  }

  const previous = getStoredAccount();
  const account: StoredAccount = { apiUrl, token: issued.token, tokenId: issued.id, email };
  saveAccount(account);
  // Logging in again replaces this machine's token; the old one must not stay valid somewhere.
  if (previous) await revokeDeviceToken(previous.apiUrl, previous.token, previous.tokenId, fetchImpl).catch(() => {});
  return account;
}

async function askForCode(
  email: string,
  io: AccountIO,
  verify: (code: string) => Promise<EmailSession>,
): Promise<EmailSession> {
  for (let attempt = 1; ; attempt++) {
    const answer = await io.ask("Code: ");
    if (answer === null) throw new AccountError("No code was entered.");
    const code = answer.replace(/\s+/g, "");
    try {
      return await verify(code);
    } catch (error) {
      const wrongCode = error instanceof AccountError && error.status !== undefined && error.status < 500;
      if (!wrongCode || error.status === 429 || attempt >= CODE_ATTEMPTS) throw error;
      io.warn(`That code did not work for ${email} (${error.message}). Try again.`);
    }
  }
}

function describeFailure(error: unknown): string {
  if (!(error instanceof AccountError)) return error instanceof Error ? error.message : String(error);
  return error.requestId ? `${error.message} (request ${error.requestId})` : error.message;
}

function terminalIO(): AccountIO & { close(): void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  // The iterator buffers lines, so input piped in ahead of a question is not lost.
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question) {
      process.stderr.write(question);
      const next = await lines.next();
      return next.done ? null : String(next.value);
    },
    say: (line) => console.log(line),
    warn: (line) => console.error(line),
    close: () => rl.close(),
  };
}

/** Returns the process exit code. */
export async function runLogin(options: { apiUrl: string; email?: string; name?: string }): Promise<number> {
  const io = terminalIO();
  try {
    const account = await login({ apiUrl: options.apiUrl, email: options.email, deviceName: options.name, io });
    io.say(`Signed in as ${account.email}. This machine's token is stored in ~/.shelra/auth.json.`);
    return 0;
  } catch (error) {
    io.warn(`Login failed: ${describeFailure(error)}`);
    return 1;
  } finally {
    io.close();
  }
}

export async function runWhoami(fetchImpl: FetchLike = fetch): Promise<number> {
  const stored = getStoredAccount();
  if (!stored) {
    console.error(`Not signed in. Run \`${CLI_NAME} login --api-url <url>\`.`);
    return 1;
  }
  try {
    const { account, credential } = await getMe(stored.apiUrl, stored.token, fetchImpl);
    console.log(`Signed in as ${account.email ?? account.id}${account.name ? ` (${account.name})` : ""}`);
    console.log(`  account  ${account.id}`);
    if (credential.type === "token") {
      console.log(`  device   ${credential.name} · ${credential.prefix} · since ${credential.createdAt.slice(0, 10)}`);
    }
    console.log(`  service  ${stored.apiUrl}`);
    return 0;
  } catch (error) {
    if (error instanceof AccountError && error.status === 401) {
      console.error(`This machine's token is no longer valid. Run \`${CLI_NAME} login\` again.`);
    } else {
      console.error(`Could not check the account: ${describeFailure(error)}`);
    }
    return 1;
  }
}

export async function runLogout(fetchImpl: FetchLike = fetch): Promise<number> {
  const stored = getStoredAccount();
  if (!stored) {
    console.log("This machine is not signed in.");
    return 0;
  }
  let revoked = true;
  try {
    await revokeDeviceToken(stored.apiUrl, stored.token, stored.tokenId, fetchImpl);
  } catch (error) {
    // Already revoked (401/404) is the goal reached; anything else leaves the token active on the server.
    revoked = error instanceof AccountError && (error.status === 401 || error.status === 404);
    if (!revoked) console.error(`Could not revoke the token on the server: ${describeFailure(error)}`);
  }
  clearAccount();
  console.log(
    revoked
      ? "Signed out: this machine's token was revoked and removed."
      : `Removed this machine's token, but it is still active on ${stored.apiUrl}; revoke ${stored.tokenId} there.`,
  );
  return revoked ? 0 : 1;
}
