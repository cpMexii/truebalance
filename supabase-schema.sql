create table if not exists public.budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.budgets enable row level security;

drop policy if exists "Users can read their own budget" on public.budgets;
create policy "Users can read their own budget"
on public.budgets for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their own budget" on public.budgets;
create policy "Users can create their own budget"
on public.budgets for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own budget" on public.budgets;
create policy "Users can update their own budget"
on public.budgets for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

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
