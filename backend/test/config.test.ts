import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { describeError } from "../src/log";

const valid = {
  DATABASE_URL:
    "postgresql://postgres.ref:s3cret-pass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
  SUPABASE_URL: "https://ref.supabase.co/",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
};

describe("configuration", () => {
  test("a complete environment loads, with defaults", () => {
    expect(loadConfig(valid)).toEqual({
      port: 3001,
      databaseUrl: valid.DATABASE_URL,
      supabaseUrl: "https://ref.supabase.co",
      supabasePublishableKey: "sb_publishable_abc",
    });
  });

  test("missing variables are named", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*SUPABASE_URL[\s\S]*SUPABASE_PUBLISHABLE_KEY/);
  });

  test("a secret key where the publishable key belongs is refused", () => {
    expect(() => loadConfig({ ...valid, SUPABASE_PUBLISHABLE_KEY: "sb_secret_xyz" })).toThrow(/publishable key/);
  });

  test("a remote database needs TLS; one on this machine does not", () => {
    const plain = valid.DATABASE_URL.replace("?sslmode=require", "");
    expect(() => loadConfig({ ...valid, DATABASE_URL: plain })).toThrow(/sslmode=require/);
    expect(loadConfig({ ...valid, DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres" }).port).toBe(3001);
  });

  test("errors never quote the connection string's password", () => {
    const plain = valid.DATABASE_URL.replace("?sslmode=require", "");
    expect(() => loadConfig({ ...valid, DATABASE_URL: plain })).not.toThrow(/s3cret-pass/);
    const logged = JSON.stringify(describeError(new Error(`connect failed for ${plain}`)));
    expect(logged).not.toContain("s3cret-pass");
    expect(logged).toContain("postgresql://postgres.ref:***@");
  });
});
