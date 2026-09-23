import "next-auth";

declare module "next-auth" {
  interface Session {
    /** Id of the provider the session was created with ("github", "google"). */
    provider?: string;
  }
}
