# 23. First-run setup, `/config` and the ShelraCode account (2026-10-06)

Status: built and tested; not exercised against a real Supabase project, real OAuth apps or a real mail provider
(see §9). Owner decisions are marked **(owner)**. Where Claude Code is the model, the claim says whether it comes from
its documentation or from my own inference.

## 1. What was asked

1. A **first-run setup** where the person sets everything: providers and keys, default mode, default model.
2. A **`/config` command** to manage the same afterwards: default provider (for Mixed only), default mode, default
   model, provider keys (add, replace, remove, declare a free plan).
3. **Accounts with login and logout**, on Supabase, where the website does the sign-in the way Claude Code's login
   does: the terminal opens the browser, the person signs in on the site and approves the device.
4. Research first, with Claude Code as the exemplar.

## 2. Research (what the others do)

Sources: Claude Code's settings and authentication documentation (code.claude.com/docs), OpenCode's provider and
auth documentation, the Codex CLI and Gemini CLI documentation, Aider's configuration documentation. Read in this
session, 2026-10-06; they change, so re-read before copying a detail.

| Tool | Setup and defaults | Keys / login | Lesson taken |
| --- | --- | --- | --- |
| Claude Code | `/config` opens one settings screen; a change is saved the moment it is made. `/model` saves the default model. Settings have scopes: user, project, local; the narrower scope wins. | `/login` and `/logout`; the browser opens, the person approves, the terminal gets the credential. A long-lived token for CI through an environment variable. (documentation) | Save on change, no "apply" step. User scope with the project overriding it. Browser login with a way out when the browser is on another machine. A token variable for headless runs. |
| OpenCode | `/connect` adds a provider; `/models` picks a model. | `opencode auth login` stores keys in an auth file. | Provider keys live in a credential store, not in the settings file. |
| Codex CLI | `config.toml`; `codex login` with a device-code option. | ChatGPT sign-in or an API key. | A pasted code is the fallback when the browser cannot call back. |
| Gemini CLI | `/auth` chooses the method; `settings.json`. | Google sign-in, key, or Vertex. | One screen per concern. |
| Aider | Flags and `.env` only; no setup screen. | Keys in the environment. | The counter-example: nothing to learn, but nothing to discover either. |

Inference (mine, not from a source): Claude Code does not ask for a billing declaration because it has one
provider; Shelra has several, some with free plans that bill a billed key, so the setup has to ask.

## 3. Decisions (owner, 2026-10-06)

- Default provider applies to **Mixed only**. Free mode is automatic across every provider it can prove free and never
  reads it.
- Keys are managed **inside `/config`**, as well as with `shelra auth`; both write the same store.
- The setup runs on the **first start and after `/logout`**.
- Defaults are user-wide; **a project's own setting overrides them** (`.shelra/settings.json` model).
- Login: **browser, local callback, or a pasted code**. The account is **required** to use Shelra; a headless or CI run
  uses a **token in `SHELRA_TOKEN`**. A login is kept, and works offline for **7 days** after the last confirmation.
- Tokens expire after **90 days**, with a warning in the last 3.
- The web sign-in offers GitHub, Google, an emailed 6-digit code, and email with password.
- Scope of this delivery: **accounts and login (with an audit trail)**. Teams, usage and plans are not built; the
  payment schema is not built either.
- The account service lives at `https://api.shelra.dev` (not deployed yet).

This reverses an older principle (the CLI never depends on a server): a signed-in account is now required, and the
agent itself still never calls the account service during a turn; only startup and `shelra login|logout|whoami` do.

## 4. Design: setup and `/config`

One state machine, `src/ui/config/flow.ts`, with no rendering and no side effects: `step(state, action)` returns the
next state and, when something must happen outside, an **effect** (`connect`, `disconnect`, `declare-free-plan`,
`set-mode`, `set-provider`, `set-model`, `refresh-models`, `sign-out`, `finish`). The view
(`src/ui/config/view.tsx`) draws the current screen and feeds it keys and pastes. The effects are run by
`src/config/services.ts`, which uses the provider admin (`src/config/provider-admin.ts`: connect, test, disconnect)
and the preferences (`src/config/preferences.ts`: settings file).

- **Setup** walks: welcome, providers, a billing question for each free-plan provider just connected, mode, and for
  Mixed the default provider and model, then a summary. Esc on the welcome skips it; it is not asked again.
- **`/config`** is a menu over the same screens; every change is saved at once. `/logout` opens it on the sign-out
  question (default answer: stay signed in). Aliases: `/settings`, `/setup`, `/signout`.
- **A key is tested before it is kept.** It is typed or pasted, shown only as dots, and stored in the credential store
  with `shelra auth`'s code path (never the settings file). A key set in the environment wins and is shown as such.
- **Billing question.** Free mode may use a provider's free plan only when the person says the key has no billing.
  The default answer is the safe one ("billing is on, or I am not sure"), so nothing can be charged.
- **Live effects.** Changing a key or a declaration resets the routing provider's configuration cache and refreshes the
  catalog (`RoutingRuntime.reload`); the mode switch uses the session's own `setPolicy`.
- Someone who already had Shelra configured before the setup existed is not asked again (`needsOnboarding`), except
  after `/logout`.

## 5. Design: the account

Tables (`backend/supabase/migrations/20261006120000_accounts_login_audit.sql`, schema `shelra`): profiles (one per
Supabase user, created by a trigger), device tokens with an expiry and a kind (`cli`, `ci`), one-time login codes,
and an append-only audit log. Row-level security on all of them; the API acts as the person (`asUser`), and only
the one-time-code exchange uses the service role.

Login (PKCE, S256):

1. `shelra login` starts a server on `127.0.0.1:<port>`, makes a random `state` and a `code_verifier`, and opens
   `https://www.shelra.dev/cli/login?state=&challenge=&port=&name=&client=`.
2. The site checks every parameter (`src/lib/cli-link.ts`), sends the person to sign in if needed, and shows the
   device name and what is being approved. Approving calls `POST /v1/cli/authorize` from the server with the person's
   session; the API returns a one-time code (5 minutes, single use, stored hashed).
3. The browser goes to `http://127.0.0.1:<port>/callback?code=&state=`. Refusing sends `error=access_denied`.
   When the browser cannot reach the terminal, the page shows `code#state` to paste.
4. The CLI checks `state`, then `POST /v1/cli/token {code, codeVerifier}`; the API checks the verifier against the
   challenge and returns a device token `shr_…` (only its SHA-256 is stored).

Policy on the machine (`src/account/session.ts`): re-verified at most every 24 hours; a failed check within 7 days of
the last success continues offline; a token past its expiry is refused locally; `SHELRA_TOKEN` is used as is. A
headless run with no valid account exits with the reason; the terminal UI shows the sign-in screen.

## 6. Files

CLI: `src/account/` (client, browser login, session policy, commands), `src/ui/account-login.tsx`,
`src/config/`, `src/ui/config/`, `src/startup/routed-session.ts` (default provider), `src/index.ts`
(`requireAccount`, `signIn`, `runSetup`, `/config` services). Backend: `backend/src/routes/{cli-login,tokens,account}.ts`.
Web: `frontend/src/app/{login,signup,account,auth,cli/login}`, `frontend/src/lib/{cli-link,api,supabase/}`,
`frontend/src/proxy.ts`.

## 7. Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PORT` | `backend/.env` | the account service; `DATABASE_URL` must carry `?sslmode=require` and a percent-encoded password |
| `SHELRA_API_URL` | the website (`Shelracode-frontend`) | the only variable the account pages need; they are live only when it is set. The website holds no Supabase value and no variable of it is `NEXT_PUBLIC_` (owner, 2026-10-07): it asks the service for the project's URL and publishable key (`GET /v1/auth/config`) |
| `SHELRA_TOKEN` | the CLI | a device token for headless and CI runs |
| `shelra login --api-url <url> --web-url <url>` | the CLI | development only: stores another API and site with the token (never read from the environment, so a project's `.env` cannot redirect a sign-in) |
| `SHELRA_NO_BROWSER=1` | the CLI | never open a browser (tests, SSH) |

Supabase dashboard: Authentication, Providers: turn on GitHub and Google (callback
`https://<ref>.supabase.co/auth/v1/callback`) and Email with the 6-digit code in the template; URL Configuration: add
`<site>/auth/callback` to the allow-list.

## 8. Starting it

```
cd backend
bun install
bun run db:push          # applies backend/supabase/migrations to DATABASE_URL (the owner runs this)
bun run check:supabase   # starts the API and checks it end to end
bun run dev              # http://localhost:3001
cd ../frontend && bun run dev
```

## 9. What is verified and what is not

Verified: unit and integration suites (`bun test` in `backend/`: 58; the CLI's account, config, flow and view
suites), rendered frames at 80x24 and 120x40, the real `App` opening `/config` and `/logout`, the frontend's type
check and production build, and the built site's `/login`, `/cli/login` and `/account` redirects.

Not verified: the migrations against the real project (not applied yet), a real GitHub/Google/email sign-in, the
full browser-to-terminal loop against a live API, the deployed `api.shelra.dev`, and email delivery.

## 10. Open

Teams, usage and plans; the payment schema; deploying the API; GitHub and Google enabled in the Supabase project;
an email template with the 6-digit code; revoking a device from the website's account page against the live API.
