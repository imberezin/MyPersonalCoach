import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Shared helpers for tests that run the real migrations on a real Postgres (PGlite, no Docker needed)
 * with a small shim of what Supabase provides (roles, auth.users, auth.uid()).
 */

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";

/**
 * The timeout of a test that builds a SECOND database inside its body (replays every migration to check a migration over
 * old rows). The default 30 s is too tight when several suites run at once; hooks have their own 60 s limit.
 */
export const OLD_DATABASE_TIMEOUT_MS = 120_000;

export type Role ="authenticated" | "anon" | "service_role";

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to service_role;
  -- Supabase's real default: every new function in public is executable by anon, authenticated and service_role.
  -- Without it the tests cannot tell whether a migration's "revoke ... from public, anon" is really there.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** A fresh database with every migration applied (sorted by name) and both test users signed up. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  // MIGRATIONS_DIR lets a mutation check point at a deliberately broken copy of the schema.
  const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }

  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [USER_A, USER_B]);
  return db;
}

/** Runs `fn` as the given Postgres role and signed-in user (null = no user), and always resets the role. */
export async function as<T>(db: PGlite, role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
