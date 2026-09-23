// Helpers and types shared by the sign-in and sign-up pages.
export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What the email + password actions hand back to the form: a message and the values to keep. */
export type PasswordFormState = { error?: string; email?: string; name?: string | null } | undefined;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function readAuthSearch(params: Record<string, string | string[] | undefined>) {
  const callbackUrl = first(params.callbackUrl);
  return {
    error: first(params.error),
    provider: first(params.provider),
    // Where to land after signing in: only same-origin paths, the dashboard otherwise.
    redirectTo: callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/dashboard",
  };
}
