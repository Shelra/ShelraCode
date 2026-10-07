import { getStoredAccount } from "../security/credentials";
import type { ModelInfo } from "../types/index";
import type { ConfigData, Effect } from "../ui/config/flow";
import { loadProjectSettings } from "../utils/settings";
import {
  loadDefaults,
  markOnboarded,
  resetOnboarding,
  saveDefaultMode,
  saveDefaultModel,
  saveDefaultProvider,
} from "./preferences";
import { createProviderAdmin, type ProviderAdmin } from "./provider-admin";

/*
 * What the setup and `/config` do when the person confirms something: the effects `src/ui/config/flow.ts` asks for.
 * The parts that belong to a running session (switching its mode, refreshing its catalog) are handed in as `live`;
 * without a session (the first-run setup) the same choices are only saved.
 */
export interface ConfigLive {
  /** Applies a mode to the running session; it also saves it. */
  setMode?: (mode: "free" | "mixed") => Promise<{ success: boolean; error?: string }>;
  /** The catalog's models as they are now. */
  models?: () => ModelInfo[];
  /** Asks the providers for their models again, within a bound. */
  refreshCatalog?: () => Promise<void>;
  /** A provider was added, removed or declared: the session must read its configuration again. */
  providersChanged?: () => void;
  /** Signs out of the ShelraCode account: revokes this machine's login and removes it. */
  signOut?: () => Promise<{ ok: boolean; message?: string }>;
}

export interface ConfigServices {
  data(): ConfigData;
  run(effect: Effect): Promise<{ ok: boolean; message?: string; data?: ConfigData; needs?: string }>;
}

export interface ConfigServicesOptions {
  admin?: ProviderAdmin;
  live?: ConfigLive;
  /** Test seams: the preferences and the account, which default to the real ones. */
  account?: () => { email: string | null } | null;
}

export function createConfigServices(options: ConfigServicesOptions = {}): ConfigServices {
  const admin = options.admin ?? createProviderAdmin();
  const live = options.live ?? {};
  const account =
    options.account ??
    (() => {
      const stored = getStoredAccount();
      return stored ? { email: stored.email } : null;
    });

  const data = (): ConfigData => ({
    providers: admin.rows(),
    defaults: loadDefaults(),
    account: account(),
    models: live.models?.() ?? [],
  });

  const changed = () => {
    live.providersChanged?.();
  };

  async function run(effect: Effect): Promise<{ ok: boolean; message?: string; data?: ConfigData; needs?: string }> {
    try {
      switch (effect.type) {
        case "connect": {
          const result = await admin.connect(effect.providerId, effect.input);
          if (!result.ok) return { ok: false, message: result.error, ...(result.needs ? { needs: result.needs } : {}) };
          changed();
          const name = admin.rows().find((row) => row.id === effect.providerId)?.name ?? effect.providerId;
          const counts =
            result.models > 0 ? `: ${result.models} models, ${result.free} that Free mode can use now` : "";
          return { ok: true, message: result.warning ?? `Connected ${name}${counts}.`, data: data() };
        }
        case "disconnect":
          admin.disconnect(effect.providerId);
          changed();
          return { ok: true, data: data() };
        case "declare-free-plan":
          admin.setFreePlan(effect.providerId, effect.declared);
          changed();
          return { ok: true, data: data() };
        case "set-mode": {
          if (live.setMode) {
            const result = await live.setMode(effect.mode);
            if (!result.success) return { ok: false, message: result.error ?? "The mode could not be changed." };
          } else {
            saveDefaultMode(effect.mode);
          }
          return { ok: true, data: data() };
        }
        case "set-provider":
          saveDefaultProvider(effect.providerId);
          return { ok: true, data: data() };
        case "set-model": {
          saveDefaultModel(effect.modelId);
          // A project that fixes its own model keeps it (its settings file may be committed, so /config never edits
          // it), so say what a person would otherwise wonder about.
          const pinned = loadProjectSettings().model;
          const stillPinned = pinned && pinned !== effect.modelId ? pinned : undefined;
          return {
            ok: true,
            message: stillPinned ? `Saved. This project still uses ${stillPinned} (its own setting).` : undefined,
            data: data(),
          };
        }
        case "refresh-models":
          await live.refreshCatalog?.();
          return { ok: true, data: data() };
        case "sign-out": {
          const result = (await live.signOut?.()) ?? { ok: false, message: "Signing out is not available here." };
          if (result.ok) resetOnboarding();
          return result.ok ? { ok: true } : { ok: false, ...(result.message ? { message: result.message } : {}) };
        }
        case "finish":
          markOnboarded();
          return { ok: true };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { data, run };
}
