import { OMNIROUTE_PRODUCTION_URL } from "../../product/identity";
import {
  createOmniRouteAdapter,
  fetchOmniRouteCatalog,
  isValidOmniRouteBaseURL,
  normalizeOmniRouteBaseURL,
  OMNIROUTE_BASE_URL_ENV,
  OMNIROUTE_PROVIDER_ID,
} from "../omniroute";
import type { CredentialField, ProviderConfig, ProviderDefinition, ResolveDeps } from "../registry";

export const OMNIROUTE_API_KEY_ENV = "OMNIROUTE_API_KEY";

/**
 * OmniRoute is reached where the user pointed Shelra (`OMNIROUTE_BASE_URL`, or the URL saved with
 * `shelra auth omniroute --url`, for a gateway they run themselves) and otherwise at the production gateway, which
 * counts as configured only once a key is given: the person is asked for the key alone. Nothing is probed,
 * installed or started on its own. The key lives in the credential store, never in the settings file; a gateway the
 * user runs may take none.
 */
function resolveConfigsFor(productionUrl: string, deps: ResolveDeps): ProviderConfig[] {
  const fromEnv = deps.env[OMNIROUTE_BASE_URL_ENV]?.trim();
  const fromSettings = deps.settings.omniroute?.baseUrl?.trim();
  const envKey = deps.env[OMNIROUTE_API_KEY_ENV]?.trim();
  const stored = deps.storedCredential(OMNIROUTE_PROVIDER_ID)?.apiKey;
  const apiKey = envKey || stored;
  const raw = fromEnv || fromSettings || (apiKey ? productionUrl : "");
  if (!raw || !isValidOmniRouteBaseURL(raw)) return [];
  return [
    {
      providerId: OMNIROUTE_PROVIDER_ID,
      baseURL: normalizeOmniRouteBaseURL(raw),
      ...(apiKey ? { credential: { apiKey } } : {}),
      source: fromEnv ? OMNIROUTE_BASE_URL_ENV : "`shelra auth omniroute`",
    },
  ];
}

/** `productionUrl` is the gateway people reach by default; without one the address is asked for too. */
export function omniRouteDefinition(productionUrl: string = OMNIROUTE_PRODUCTION_URL): ProviderDefinition {
  const fields: readonly CredentialField[] = productionUrl
    ? [{ name: "apiKey", label: "OmniRoute key", secret: true }]
    : [
        { name: "url", label: "OmniRoute address", secret: false, hint: "the gateway's address, ending in /v1" },
        {
          name: "apiKey",
          label: "Endpoint key",
          secret: true,
          optional: true,
          hint: "leave empty if yours asks for none",
        },
      ];
  return {
    id: OMNIROUTE_PROVIDER_ID,
    name: "OmniRoute",
    canBill: true,
    keyless: true,
    fields,
    setupHint: `set ${OMNIROUTE_BASE_URL_ENV} (for example http://localhost:20128/v1) or run \`shelra auth omniroute --url <url>\``,
    mixedDefaultModelId: "omniroute/auto",
    resolveConfigs: (deps) => resolveConfigsFor(productionUrl, deps),
    discoverModels: (config, context) => fetchOmniRouteCatalog(config, context),
    createAdapter: (config, context) => createOmniRouteAdapter(config, context),
  };
}
