-- Device tokens: the credential `shelra login` stores so the CLI can act for an account without keeping the
-- person's Supabase session. Only a token's SHA-256 is stored; the token itself is shown once, at creation.
-- Revoking a token deletes its row, so it stops working at once.
--
-- Application tables live in the `shelra` schema, which the Data API (PostgREST, GraphQL) does not expose:
-- clients sign in with Supabase Auth and reach data only through the Shelra API, the one holder of the
-- database credential. The API does a person's work as the `authenticated` role with that person's id in
-- the JWT claim settings (backend/src/db.ts, asUser), so these policies, not only the API's queries, keep
-- that work to the person's own rows.

create schema if not exists shelra;

create table shelra.access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  token_prefix text not null check (token_prefix ~ '^shr_[A-Za-z0-9_-]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index access_tokens_user_id_idx on shelra.access_tokens (user_id);

alter table shelra.access_tokens enable row level security;

create policy "read own tokens" on shelra.access_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "create own tokens" on shelra.access_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "revoke own tokens" on shelra.access_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Exactly what the API does for a person: read their tokens, add one, delete one. Nothing may change a token.
grant usage on schema shelra to authenticated;
grant select, insert, delete on shelra.access_tokens to authenticated;
