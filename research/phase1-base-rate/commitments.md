# Commitments (fixed before sampling, 2026-09-18)

Derived from every ADR present at each repository's `HEAD` on 2026-09-18, following `PROTOCOL.md`.
A commitment is included only when the ADR text states an ongoing rule for future code (must, shall,
should, will, avoid, stop, always, never, "for all new ..."). An ADR that only records which option
was chosen, a one-time migration, an evaluation or a process rule yields none; the exclusions are
listed per repository with their reason. ADR files without a status line are treated as accepted,
since the repositories keep proposed and rejected ADRs explicitly marked.

**Strength.** `obligation` for must/shall/should/will/avoid/stop/always/never. `preference` for
"prefer", "recommended" and similar. The primary rate counts obligations only; the rate including
preferences is reported beside it.

**Kind.** `behavior` (what the running system does for users or clients), `api` (a published
interface or wire format), `library` (which dependency to use), `structure` (where code lives and
how modules are organized), `convention` (how code is written), `testing` (how tests are written).

**Screen.** Patterns searched in added lines (`+` lines of the diff) of in-scope files, as a recall
aid only. Every sampled pull request is also read in full against every commitment in scope; a
pattern hit is not a label and a pattern miss is not a clean bill.

## backstage/backstage (`docs/architecture-decisions/`)

| Id | ADR | Rule (quoted or closely paraphrased) | Scope | Strength | Kind | Screen |
|---|---|---|---|---|---|---|
| B1 | 003 | "We will stop using default exports except when absolutely necessary (such as `React.lazy` modules)." Framework-mandated defaults (Storybook CSF files, tool config files) count as necessary. | `packages/*/src`, `plugins/*/src`, TS/JS | obligation | convention | `^\+\s*export default` |
| B2 | 004 | "Each index file will only re-export from its own immediate directory children, and only index files will have re-exports." Index-to-index re-exports use `export *`; index-to-file re-exports enumerate symbols. | `packages/*/src`, `plugins/*/src` | obligation | structure | re-export (`export ... from`) in a non-`index` file; in an index file, a re-export whose path has more than one segment or starts with `..` |
| B3 | 006 | "`React.FC` and `React.SFC` should be avoided in our codebase when adding new code." | TSX/TS in `packages/`, `plugins/` | obligation | convention | `React\.(FC|SFC|FunctionComponent)\b`, `:\s*(FC|SFC|FunctionComponent)<` |
| B4 | 007 | "Any `fetch` or `XMLHTTPRequest` that happens should be mocked by using `msw`." Replacing global `fetch` or mocking a fetch library in a test is a violation; injecting a fake `fetchApi`/`typeof fetch` into a client under test is not, since no request happens. | test files in `packages/`, `plugins/` | obligation | testing | `(global|globalThis|window)\.fetch\s*=`, `spyOn\((global|globalThis|window),\s*'fetch'`, `jest\.mock\('(node-fetch|cross-fetch|axios)'`, `fetch-mock` |
| B5 | 010 | "All core packages and plugins within Backstage should use `Luxon` for any date manipulation or formatting that cannot be easily accomplished with the native JavaScript `Date` object." | `packages/`, `plugins/` | obligation | library | imports or new dependencies of `moment`, `date-fns`, `dayjs` |
| B6 | 011 | "We will place all plugin related code in the `plugins/` directory"; packages named `x`, `x-backend`, `x-react`, `x-node`, `x-common`, `x-module-<name>`, `x-backend-module-<name>`, prefixed `@backstage/plugin-`. | new `package.json` files | obligation | structure | added `package.json` whose `name` breaks the pattern, or plugin code added under `packages/` |
| B7 | 012 | "We use `toLocaleString` and Luxon's ... Date and Time presets" instead of custom `toFormat` formats when displaying dates in the UI. | frontend UI code | obligation | convention | `\.toFormat\(` in frontend packages |
| B8 | 014 | "All code that is executed in Node.js (including backend and CLIs) should use the native `fetch`"; "gradually transition away from third party `fetch` replacement packages such as `node-fetch`". | Node-side packages (`*-backend*`, `*-node`, `backend-*`, `cli`) | obligation | library | imports or new dependencies of `node-fetch`, `axios`, `got`, `superagent`, `request`, `isomorphic-fetch` in Node-side code |
| B9 | 014 | "Frontend plugins and packages should prefer to use the `fetchApiRef`." | frontend packages | preference | library | bare `fetch(` in frontend code |
| B10 | 015 | Options that provide JSX elements or components use `element`, `component` or `loader` with the specified types. | `packages/frontend-*/src` public option types | obligation | api | new option properties typed `JSX.Element`, `ComponentType` or returning elements, named otherwise |
| B11 | 009 | Entity references in frontend URLs "shall take the following form" `/:namespace/:kind/:name`; "all three parts are required under all circumstances". | frontend routes | obligation | api | read only |

Excluded: 001 (adopting ADRs), 002 (descriptor format specification enforced by the catalog's own
validation, no ongoing rule for code), 005 (states what the catalog "should eventually support"),
008 ("a default, not a requirement"), 013 (superseded by 014).

## mozilla/fxa (`docs/adr/`)

| Id | ADR | Rule (quoted or closely paraphrased) | Scope | Strength | Kind | Screen |
|---|---|---|---|---|---|---|
| F1 | 0022 | "We will stop using hawk in future work that requires authentication." | auth code in all packages | obligation | api | new `hawk` imports, Hawk strategy use or Hawk signing in new routes or clients |
| F2 | 0044 | "Use auth-client for all new network requests, or prefer auth-client and only use GQL where already set up." | `packages/fxa-settings/src` | obligation | library | new `gql` documents, new `useQuery`/`useMutation` from `@apollo/client` |
| F3 | 0043 | Functional-test implementation guidelines: page models tied to individual pages; "Locators use user-facing indicators (e.g., `getByRole`, `getByText` instead of test id, css classes)". | `packages/functional-tests` | obligation | testing | `getByTestId\(`, `data-testid`, `locator\('[.#]` |
| F4 | 0019 | Internal dependencies are declared with the `workspace:*` dependency type. | `package.json` files | obligation | structure | internal package dependency (`fxa-*`, `@fxa/*`) added with a version other than `workspace:` |
| F5 | 0032 | FTL files use `en.ftl`, per component; fallback text is always provided (wrappers exist "to enforce fallback text is always provided"). | `fxa-settings`, `fxa-payments-server`, `fxa-react`, `fxa-auth-server` | obligation | convention | added `en-US.ftl`; self-closing `<FtlMsg ... />` without fallback; `getString(` calls without a fallback argument |
| F6 | 0040 | A Stripe library "will wrap all calls to Stripe, and apply the correct type util to the Stripe type". | payments code | obligation | structure | new `import Stripe from 'stripe'` or `new Stripe(` outside the Stripe wrapper library |
| F7 | 0039 | Container component abstraction applies "to React pages in the `fxa-settings` package but not Settings pages": data operations live in the container, not the page component. | `packages/fxa-settings/src/pages` except Settings | obligation | structure | read only |
| F8 | 0051 | `lastAuthorizedTosAt` "must _not_ be bumped by silent paths (`prompt=none`, token exchange)"; rows are written at the interactive authorization grant only. | `fxa-auth-server` OAuth code | obligation | behavior | read only |
| F9 | 0048 | Browser services use refresh tokens; token exchange sends "only the additional scopes needed"; adding a non-key-bearing scope "must not trigger password entry". | `fxa-auth-server` OAuth, `fxa-settings` flows | obligation | behavior | read only |
| F10 | 0005 | "Only ask authenticated users for a password if encryption keys are required." | sign-in and OAuth flows | obligation | behavior | read only |
| F11 | 0004 | Subscription capabilities are conveyed as a single profile assertion listing capability strings, mapped by requesting client id. | subscription profile code | obligation | api | read only |
| F12 | 0020 | New back-end services use NestJS; legacy services backport NestJS code organization and use `typedi` for dependency injection. | new services and packages | obligation | structure | new server packages without NestJS |
| F13 | 0015 | "Use CSS Variables, Prefer SCSS over CSS-in-JS." | `fxa-settings` | preference | library | imports of `styled-components`, `@emotion/*` |
| F14 | 0028 | "We should prefer [Playwright] for new tests." | functional tests | preference | testing | new Intern functional test files |

Excluded: 0000 (adopting ADRs); 0001, 0002, 0003, 0008, 0010, 0011, 0012, 0013, 0016, 0021, 0023,
0024, 0025, 0026, 0027, 0029, 0033, 0035, 0036, 0037, 0041, 0042, 0046 (record a chosen option,
a stack choice or a one-time migration without an ongoing rule for future code); 0006 (the outcome
section chooses an option without stating obligations); 0009 and 0045 (initiatives: identify, pilot,
audit); 0030 (merge process, not code); 0034 (diagram tooling, documentation only); 0007, 0017,
0018, 0047, 0049, 0050 (proposed); 0014 (superseded); 0038 (rejected).

## Sylius/Sylius (`adr/`)

| Id | ADR | Rule (quoted or closely paraphrased) | Scope | Strength | Kind | Screen |
|---|---|---|---|---|---|---|
| S1 | 2022_03_24 | "Flushing outside of handlers": message handlers do not flush; the command bus wraps them in a transaction. | message handlers | obligation | convention | `->flush\(` in files under `*Handler*` or `MessageHandler/` |
| S2 | 2022_03_18 | "Passing only raw data or identifiers" in commands and events, not objects. | command and event classes | obligation | api | new command/event constructor parameters typed with entity interfaces |
| S3 | 2024_08_29, 2021_05_06 | "Anyone using Sylius should use `sylius.command_bus` for commands, `sylius.event_bus` for events, `sylius.query_bus` for queries." | services config and code | obligation | convention | `sylius_default.bus` or other bus ids |
| S4 | 2020_11_12 | Handlers explicitly declare which bus they are registered to. | handler service definitions | obligation | convention | `messenger.message_handler` tag or `#[AsMessageHandler]` without a bus |
| S5 | 2024_10_03 | Services use `dot` notation ids, with an `FQCN` alias only for services implementing a non-generic interface; form types, message handlers, validators, listeners and registries stay dot-only. | service definitions | obligation | convention | new service ids that are FQCN-only for those kinds, or dot ids missing |
| S6 | 2024_07_15 | State providers live in `StateProvider/{Admin,Shop,Common}/{Resource}/` and command providers carry a `Provider` suffix. | `ApiBundle/StateProvider` | obligation | structure | new provider files outside the structure |
| S7 | 2024_07_16 | Query extensions live in `Doctrine/ORM/QueryExtension/{Admin,Shop,Common}/{Resource}/`. | `ApiBundle/Doctrine` | obligation | structure | new extension files outside the structure |
| S8 | 2024_07_16 | State processors live in `StateProcessor/{Admin,Shop}/{Resource}/` split into persist and remove. | `ApiBundle/StateProcessor` | obligation | structure | new processor files outside the structure |
| S9 | 2024_10_22 | Filters organized by resource and section; filter ids `sylius_api.[filter_type].[context].[resource]`. | API filters | obligation | structure | new filter ids or files breaking the format |
| S10 | 2025_04_07 | Unit tests migrate from PHPSpec to PHPUnit: no new PHPSpec specifications. | `spec/` and unit tests | obligation | testing | new files under `spec/` or new `ObjectBehavior` classes |
| S11 | 2024_05_15 | Admin panel uses separate base form types instead of form type extensions. | `AdminBundle` forms | obligation | structure | new `AbstractTypeExtension` subclasses in admin context |
| S12 | 2024_11_28 | Language flags are removed from the UI entirely. | templates and UI components | obligation | behavior | flag icons tied to locales in templates |
| S13 | 2021_04_15 | Commands receive related resources as IRIs, transformed to `id`/`code`. | API commands | obligation | api | read only |
| S14 | 2020_03_03 | "Product option values should always be provided with their IRIs"; "Translations should always be embedded as the collection of objects." | API resources | obligation | api | read only |
| S15 | 2021_02_05, 2020_09_01 | API under `/api/v2`, with prefixed admin and shop paths. | API routes | obligation | api | new routes outside the prefixes |
| S16 | 2020_05_13 | Non-CRUD operations: the `Controller` REST archetype "should be considered as a recommended solution". | API | preference | api | read only |

Excluded: 2020_03_03 feature coverage (plan to add `@api` scenarios, one-time), 2020_11_18 (records
the chosen option), 2021_06_15 (customization mechanism for end users), 2022_02_21 and 2022_03_15
(record a chosen option), 2021_06_24 (proposed), 2021_07_05 (rejected).
