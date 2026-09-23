"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import type { PasswordFormState } from "@/lib/auth-page";
import { getAuthProviders } from "@/lib/auth-providers";
import { authCopy } from "@/lib/content";
import { createUser, findUserByEmail, isEmail, normalizeEmail, passwordAuthAvailable } from "@/lib/users";

// Only same-origin paths are accepted as redirect targets.
function safePath(value: FormDataEntryValue | null, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

/*
 * Starts the OAuth flow of the provider named in the form. On success Auth.js
 * redirects to the provider and back to `redirectTo`; a failure sends the user
 * back to the page they came from with the error code in the query string.
 */
export async function signInWith(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  const back = safePath(formData.get("back"), "/login");
  const redirectTo = safePath(formData.get("redirectTo"), "/account");
  const info = getAuthProviders().find((p) => p.id === provider);
  if (!info?.configured) redirect(`${back}?error=Configuration&provider=${encodeURIComponent(provider)}`);
  try {
    await signIn(provider, { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`${back}?error=${encodeURIComponent(error.type)}&provider=${encodeURIComponent(provider)}`);
    }
    // Next's own redirect is thrown as an error and must pass through.
    throw error;
  }
}

const formErrors = authCopy.form.errors;

// Email + password sign-in. Returns the message to show; on success Auth.js redirects.
export async function signInWithPassword(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const redirectTo = safePath(formData.get("redirectTo"), "/account");
  if (!isEmail(email)) return { error: formErrors.email, email };
  if (!password) return { error: formErrors.password, email };
  if (!passwordAuthAvailable()) return { error: formErrors.unavailable, email };
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: error.type === "CredentialsSignin" ? formErrors.wrong : formErrors.failed, email };
    }
    throw error;
  }
  return undefined;
}

// Creates the account, then signs it in the same way.
export async function signUpWithPassword(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const name =
    String(formData.get("name") ?? "")
      .trim()
      .slice(0, 80) || null;
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const redirectTo = safePath(formData.get("redirectTo"), "/account");
  if (!isEmail(email)) return { error: formErrors.email, email, name };
  if (password.length < 8) return { error: formErrors.short, email, name };
  if (!passwordAuthAvailable()) return { error: formErrors.unavailable, email, name };
  try {
    if (await findUserByEmail(email)) return { error: formErrors.exists, email, name };
    await createUser({ email, name, password });
  } catch (error) {
    console.error("[auth] could not create the account", error);
    return { error: formErrors.failed, email, name };
  }
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) return { error: formErrors.failed, email, name };
    throw error;
  }
  return undefined;
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
