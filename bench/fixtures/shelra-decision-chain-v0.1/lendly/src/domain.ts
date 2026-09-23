export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export interface Book {
  id: number;
  title: string;
  author: string;
  isbn: string;
  createdAt: string;
}

/** A plausible email address: something@something.tld, without spaces. */
export function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

/** A non-empty string, trimmed; undefined for anything else. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
