/**
 * Local models are switched off for now (owner, 2026-10-07): no fallback starts one, `--local` finds none, and the model
 * list shows only cloud models. Cloud routing (Free and Mixed) is unaffected. `SHELRA_LOCAL_MODELS=on` turns them back on
 * without a code change, for whoever wants to work on them.
 */
export function localModelsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|on|true|yes)$/iu.test(env.SHELRA_LOCAL_MODELS?.trim() ?? "");
}
