-- A fault handed to a worker reaches that worker's phone as a notification, and the worker answers "קיבלתי".
--
-- faults.notified_at      when the push reached at least one of the worker's phones (stamped by the fault-push function only)
-- faults.acknowledged_at  when the worker pressed קיבלתי, on the phone or on the notification (the database's clock)
-- Both clear when the fault is handed to someone else or the instruction changes: that is a new message.
--
-- push_subscriptions  one row per phone that allowed notifications, filed under the worker chosen on it
-- push_keys           the sender's VAPID pair and the secret that signs the notification's קיבלתי button
-- Both are closed to every browser role; phones reach them only through push_register / push_unregister / push_workers.
--
-- Every assignment calls the fault-push edge function through pg_net after the transaction commits,
-- so the overview's walk, the faults page and any later screen send alike.

create extension if not exists pg_net with schema extensions;

alter table public.faults
  add column if not exists notified_at timestamptz,
  add column if not exists acknowledged_at timestamptz;

create or replace function public.faults_stamp_resolution()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  caller text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolution := nullif(btrim(new.resolution), '');
    if new.resolution is null then raise exception 'צריך לכתוב מה נעשה כדי לסגור תקלה'; end if;
    -- A worker's phone has no login, so a fault handed to a worker closes in that worker's name.
    new.resolved_by := coalesce(actor_label(), (select name from workers where id = new.assigned_to));
  elsif new.status = 'open' and old.status = 'resolved' then
    new.resolution := null;
    new.resolved_by := null;
  else
    new.resolved_by := old.resolved_by;
  end if;

  -- Handing a fault on takes an instruction; when and by whom is stamped here, never taken from the client.
  if new.assigned_to is null then
    new.instruction := null;
    new.assigned_at := null;
    new.assigned_by := null;
  elsif new.assigned_to is distinct from old.assigned_to or new.instruction is distinct from old.instruction then
    new.instruction := nullif(btrim(new.instruction), '');
    if new.instruction is null then raise exception 'צריך לכתוב לעובד מה לעשות'; end if;
    new.assigned_at := now();
    new.assigned_by := actor_label();
  else
    new.assigned_at := old.assigned_at;
    new.assigned_by := old.assigned_by;
  end if;

  -- A new hand or a new instruction is a new message: it waits to be sent and to be received again.
  if new.assigned_to is distinct from old.assigned_to or new.instruction is distinct from old.instruction then
    new.notified_at := null;
    new.acknowledged_at := null;
  else
    -- Only the push function says a notification went out.
    if new.notified_at is distinct from old.notified_at and caller in ('anon', 'authenticated') then
      new.notified_at := old.notified_at;
    end if;
    -- Received is the worker's own press, on a fault that is in someone's hands, at the database's time.
    if new.acknowledged_at is distinct from old.acknowledged_at then
      new.acknowledged_at := case when new.acknowledged_at is null or new.assigned_to is null then null else now() end;
    end if;
  end if;
  return new;
end $function$;

create table if not exists public.push_keys (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  ack_secret text not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on table public.push_keys from anon, authenticated;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  worker_id uuid not null references public.workers(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_worker on public.push_subscriptions (worker_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- A phone files its subscription under the worker chosen on it; choosing another worker moves it.
create or replace function public.push_register(p_worker uuid, p_endpoint text, p_p256dh text, p_auth text, p_agent text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_endpoint is null or p_endpoint !~ '^https://([a-z0-9-]+\.)*(googleapis\.com|google\.com|mozilla\.com|apple\.com|windows\.com)(:[0-9]+)?/' then
    raise exception 'שירות ההתראות של הדפדפן לא מוכר';
  end if;
  if length(p_endpoint) > 1000 or coalesce(length(p_p256dh), 0) not between 80 and 100 or coalesce(length(p_auth), 0) not between 16 and 30 then
    raise exception 'פרטי ההתראות לא תקינים';
  end if;
  if not exists (select 1 from workers where id = p_worker and active) then
    raise exception 'העובד לא נמצא';
  end if;
  insert into push_subscriptions (endpoint, worker_id, p256dh, auth, user_agent)
  values (p_endpoint, p_worker, p_p256dh, p_auth, left(p_agent, 300))
  on conflict (endpoint) do update
    set worker_id = excluded.worker_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, seen_at = now();
end $function$;

create or replace function public.push_unregister(p_endpoint text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from push_subscriptions where endpoint = p_endpoint;
$function$;

-- Which workers have a phone that will ring, for the manager choosing whom to hand a fault to.
create or replace function public.push_workers()
 returns table (worker_id uuid, devices integer)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select worker_id, count(*)::integer from push_subscriptions group by worker_id;
$function$;

revoke all on function public.push_register(uuid, text, text, text, text) from public;
revoke all on function public.push_unregister(text) from public;
revoke all on function public.push_workers() from public;
grant execute on function public.push_register(uuid, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.push_unregister(text) to anon, authenticated, service_role;
grant execute on function public.push_workers() to anon, authenticated, service_role;

create or replace function public.faults_push_assigned()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.assigned_to is null or new.status <> 'open' then return null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to and new.instruction is not distinct from old.instruction then
    return null;
  end if;
  -- Queued now, sent by pg_net once this transaction commits; a refused assignment sends nothing.
  perform net.http_post(
    url := 'https://iruwqnlqlaffriskowcq.supabase.co/functions/v1/fault-push',
    body := jsonb_build_object('fault_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
  return null;
end $function$;

drop trigger if exists faults_push_assigned on public.faults;
create trigger faults_push_assigned after insert or update on public.faults
  for each row execute function public.faults_push_assigned();
