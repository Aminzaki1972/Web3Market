-- GitHub App installation ownership and one-time setup intents for Auto-Fix PR.
-- Service-role only: browser clients must never read or write these records directly.

create table if not exists public.w3m_github_app_install_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists w3m_github_app_install_intents_expiry_idx
  on public.w3m_github_app_install_intents (expires_at);

create table if not exists public.w3m_github_app_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id bigint not null unique,
  account_id bigint not null,
  account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.w3m_github_app_installation_repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id bigint not null references public.w3m_github_app_installations(installation_id) on delete cascade,
  repository_id bigint not null,
  repository_full_name text not null,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  unique (installation_id, repository_id)
);

create index if not exists w3m_github_app_installations_user_idx
  on public.w3m_github_app_installations (user_id);
create index if not exists w3m_github_app_installation_repositories_name_idx
  on public.w3m_github_app_installation_repositories (lower(repository_full_name));

alter table public.w3m_github_app_install_intents enable row level security;
alter table public.w3m_github_app_installations enable row level security;
alter table public.w3m_github_app_installation_repositories enable row level security;

revoke all on public.w3m_github_app_install_intents from anon, authenticated;
revoke all on public.w3m_github_app_installations from anon, authenticated;
revoke all on public.w3m_github_app_installation_repositories from anon, authenticated;

grant all on public.w3m_github_app_install_intents to service_role;
grant all on public.w3m_github_app_installations to service_role;
grant all on public.w3m_github_app_installation_repositories to service_role;
