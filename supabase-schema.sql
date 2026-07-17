create table if not exists public.budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.budgets add column if not exists share_code text unique;

create table if not exists public.budget_members (
  budget_user_id uuid not null references public.budgets(user_id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role = 'editor'),
  joined_at timestamptz not null default now(),
  primary key (budget_user_id, member_id)
);

alter table public.budget_members enable row level security;

alter table public.budgets enable row level security;

drop policy if exists "Users can read their own budget" on public.budgets;
create policy "Users can read their own budget"
on public.budgets for select
using (
  auth.uid() = user_id or exists (
    select 1 from public.budget_members
    where budget_user_id = budgets.user_id and member_id = auth.uid()
  )
);

drop policy if exists "Users can create their own budget" on public.budgets;
create policy "Users can create their own budget"
on public.budgets for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own budget" on public.budgets;
create policy "Users can update their own budget"
on public.budgets for update
using (
  auth.uid() = user_id or exists (
    select 1 from public.budget_members
    where budget_user_id = budgets.user_id and member_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id or exists (
    select 1 from public.budget_members
    where budget_user_id = budgets.user_id and member_id = auth.uid()
  )
);

drop policy if exists "Members can view their membership" on public.budget_members;
create policy "Members can view their membership"
on public.budget_members for select
using (member_id = auth.uid() or budget_user_id = auth.uid());

drop policy if exists "Members can leave shared budgets" on public.budget_members;
create policy "Members can leave shared budgets"
on public.budget_members for delete
using (member_id = auth.uid() or budget_user_id = auth.uid());

create or replace function public.join_shared_budget(p_share_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id
  from public.budgets
  where share_code = upper(trim(p_share_code));

  if owner_id is null then
    raise exception 'Invalid sharing code';
  end if;
  if owner_id = auth.uid() then
    raise exception 'This is already your budget';
  end if;

  insert into public.budget_members (budget_user_id, member_id, role)
  values (owner_id, auth.uid(), 'editor')
  on conflict (budget_user_id, member_id) do update set role = 'editor';

  return owner_id;
end;
$$;

grant execute on function public.join_shared_budget(text) to authenticated;

create or replace function public.protect_budget_share_code()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() <> old.user_id and new.share_code is distinct from old.share_code then
    raise exception 'Only the budget owner can change the sharing code';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_budget_share_code on public.budgets;
create trigger protect_budget_share_code
before update of share_code on public.budgets
for each row execute function public.protect_budget_share_code();

create or replace function public.set_budget_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_budget_updated_at on public.budgets;
create trigger set_budget_updated_at
before update on public.budgets
for each row execute function public.set_budget_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.budgets;
exception
  when duplicate_object then null;
end;
$$;
