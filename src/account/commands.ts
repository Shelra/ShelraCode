import { hostname } from "node:os";
import readline from "node:readline";
import packageJson from "../../package.json" with { type: "json" };
import { ACCOUNT_API_URL, ACCOUNT_WEB_URL, CLI_NAME } from "../product/identity";
import { clearAccount, getStoredAccount, type StoredAccount, saveAccount } from "../security/credentials";
import { type BrowserLoginEvent, browserLogin } from "./browser-login";
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
 * `shelra login`, `whoami` and `logout`. Login opens the website, the person signs in and authorizes this
 * machine, and the CLI trades the one-time code it gets back for a device token that lasts 90 days (the way Claude
 * Code signs in). `--email` signs in with a code sent by email instead, with no browser, so it works over SSH.
 * Either way only the device token is kept, in ~/.shelra/auth.json; it can be revoked on its own, from here or the
 * website.
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

/** The line a person sees saying what is being approved: this CLI, its version and the system it runs on. */
export function clientInfo(): string {
  return `${CLI_NAME} ${packageJson.version} on ${process.platform}`.slice(0, 120);
}

/** Signs in through the browser and stores the device token. */
export async function loginWithBrowser(options: {
  apiUrl?: string;
  webUrl?: string;
  deviceName?: string;
  io: AccountIO;
  fetchImpl?: FetchLike;
  openBrowser?: (url: string) => Promise<boolean>;
  readPasted?: (signal: AbortSignal) => Promise<string | null>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: BrowserLoginEvent) => void;
}): Promise<StoredAccount> {
  const { io } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = normalizeAccountUrl(options.apiUrl ?? ACCOUNT_API_URL);
  const webUrl = normalizeAccountUrl(options.webUrl ?? ACCOUNT_WEB_URL);
  // Another service is a development setup: its sign-in page cannot be guessed from the API's address.
  if (options.apiUrl && apiUrl !== ACCOUNT_API_URL && !options.webUrl) {
    throw new AccountError("A different --api-url needs the --web-url of the sign-in page that goes with it.");
  }
  const issued = await browserLogin({
    apiUrl,
    webUrl,
    deviceName: options.deviceName ?? defaultDeviceName(),
    clientInfo: clientInfo(),
    fetchImpl,
    openBrowser: options.openBrowser,
    readPasted: options.readPasted,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    notify: (event) => {
      options.onEvent?.(event);
      if (event.type === "url") {
        io.say(
          event.opened
            ? "Opening your browser to sign in. If it does not open, go to:"
            : "Open this address in a browser to sign in:",
        );
        io.say(`  ${event.url}`);
      } else if (event.type === "waiting") {
        io.say("Waiting for you to sign in. If the browser cannot reach this terminal, paste the code it shows here.");
      } else if (event.type === "paste-ignored") {
        io.warn(`${event.reason} Still waiting for the browser, or paste the code again.`);
      }
    },
  });
  const previous = getStoredAccount();
  const account: StoredAccount = {
    apiUrl,
    ...(webUrl === ACCOUNT_WEB_URL ? {} : { webUrl }),
    token: issued.token,
    tokenId: issued.id,
    email: issued.email,
    name: issued.displayName,
    expiresAt: issued.expiresAt ?? null,
    verifiedAt: new Date().toISOString(),
  };
  saveAccount(account);
  // Signing in again replaces this machine's token; the old one must not stay valid somewhere.
  if (previous) {
    await revokeDeviceToken(previous.apiUrl, previous.token, previous.tokenId, fetchImpl).catch(() =>
      io.warn("Could not revoke this machine's previous login on the server; it expires on its own."),
    );
  }
  return account;
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
  const account: StoredAccount = {
    apiUrl,
    token: issued.token,
    tokenId: issued.id,
    email,
    expiresAt: issued.expiresAt ?? null,
    verifiedAt: new Date().toISOString(),
  };
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

/** Returns the process exit code. `email` set (even to "") signs in with an emailed code instead of the browser. */
export async function runLogin(options: {
  apiUrl?: string;
  webUrl?: string;
  email?: string | boolean;
  name?: string;
}): Promise<number> {
  const io = terminalIO();
  try {
    const account =
      options.email === undefined || options.email === false
        ? await loginWithBrowser({
            apiUrl: options.apiUrl,
            webUrl: options.webUrl,
            deviceName: options.name,
            io,
            readPasted: () => io.ask("Code (only if the browser could not reach this terminal): "),
          })
        : await login({
            apiUrl: options.apiUrl ?? ACCOUNT_API_URL,
            email: typeof options.email === "string" && options.email ? options.email : undefined,
            deviceName: options.name,
            io,
          });
    io.say(`Signed in as ${account.email}. This machine's login is stored in ~/.shelra/auth.json.`);
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
    console.error(`Not signed in. Run \`${CLI_NAME} login\`.`);
    return 1;
  }
  try {
    const { account, credential } = await getMe(stored.apiUrl, stored.token, fetchImpl);
    console.log(`Signed in as ${account.email ?? account.id}${account.name ? ` (${account.name})` : ""}`);
    console.log(`  account  ${account.id}`);
    if (credential.type === "token") {
      console.log(`  device   ${credential.name} · ${credential.prefix} · since ${credential.createdAt.slice(0, 10)}`);
      console.log(
        `  login    ${credential.expiresAt ? `valid until ${credential.expiresAt.slice(0, 10)}` : "does not expire"}`,
      );
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

export type SignOutResult = {
  /** True when this machine no longer holds a login (it may still be valid on the server when `revoked` is false). */
  signedOut: boolean;
  /** True when the server confirmed the token is gone. */
  revoked: boolean;
  message: string;
};

/** Revokes this machine's token on the server, then removes it here. Used by `shelra logout` and `/logout`. */
export async function signOutAccount(fetchImpl: FetchLike = fetch): Promise<SignOutResult> {
  const stored = getStoredAccount();
  if (!stored) return { signedOut: true, revoked: true, message: "This machine is not signed in." };
  let revoked = true;
  let detail = "";
  try {
    await revokeDeviceToken(stored.apiUrl, stored.token, stored.tokenId, fetchImpl);
  } catch (error) {
    // Already revoked (401/404) is the goal reached; anything else leaves the token active on the server.
    revoked = error instanceof AccountError && (error.status === 401 || error.status === 404);
    if (!revoked) detail = `Could not revoke the token on the server: ${describeFailure(error)}`;
  }
  clearAccount();
  return {
    signedOut: true,
    revoked,
    message: revoked
      ? "Signed out: this machine's login was revoked and removed."
      : `${detail ? `${detail}. ` : ""}Removed this machine's login, but it is still active on ${stored.apiUrl}; revoke ${stored.tokenId} on the website.`,
  };
}

export async function runLogout(fetchImpl: FetchLike = fetch): Promise<number> {
  const result = await signOutAccount(fetchImpl);
  console.log(result.message);
  return result.revoked ? 0 : 1;
}
