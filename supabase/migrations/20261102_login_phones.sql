-- Who may open an account. Closed to the public key on purpose: a list the anon key
-- could read or add to would protect nothing, which rules out public.workers.
create table public.login_phones (
  phone text primary key check (phone ~ '^[1-9][0-9]{6,14}$'), -- international, no plus: 972501234567
  note text,
  created_at timestamptz not null default now()
);

alter table public.login_phones enable row level security;
revoke all on table public.login_phones from anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant select on table public.login_phones to supabase_auth_admin;
create policy "auth reads login phones" on public.login_phones
  for select to supabase_auth_admin using (true);

-- Before User Created hook: runs before a user exists and before any SMS goes out.
-- No listed phone means no account, so email signups are refused as well.
-- Takes effect once enabled in the dashboard: Authentication > Hooks > Before User Created.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  signup_phone text := regexp_replace(coalesce(event->'user'->>'phone', ''), '\D', '', 'g');
begin
  if exists (select 1 from public.login_phones l where l.phone = signup_phone) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'phone_not_allowed'));
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
