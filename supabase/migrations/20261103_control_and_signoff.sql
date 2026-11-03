-- בקרה: a fault closes with what was done about it and who did it, an exit without a receipt shows who approved it,
-- and the manager signs the day. The job still freezes a day at midnight; the signature says who stands behind it.
-- Additive, so a site still running the older code keeps working. Requiring the resolution is its own migration,
-- 20261103_fault_resolution_required.sql, and goes out with the code that asks for it.

alter table faults add column if not exists resolution text;
alter table faults add column if not exists resolved_by text;

-- Who is signed in, in words a screen can show. Never a whole phone number.
create or replace function actor_label() returns text
language sql stable security definer set search_path = public as $$
  select case when s.phone is null then 'מנהל' else 'מנהל ראשי' end || ' · ' || right(u.phone, 4)
  from auth.users u
  left join super_admins s on s.phone = u.phone
  where u.id = auth.uid();
$$;
revoke execute on function actor_label() from public, anon;
grant execute on function actor_label() to authenticated;

-- The database writes who closed a fault, so a client can't claim someone else did. Reopening clears the closing.
create or replace function faults_stamp_resolution() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolution := nullif(btrim(new.resolution), '');
    new.resolved_by := actor_label();
  elsif new.status = 'open' and old.status = 'resolved' then
    new.resolution := null;
    new.resolved_by := null;
  else
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end $$;
revoke execute on function faults_stamp_resolution() from public, anon, authenticated;
drop trigger if exists faults_stamp_resolution on faults;
create trigger faults_stamp_resolution before update on faults for each row execute function faults_stamp_resolution();

-- exit_passes stays closed to clients: this is the only way to read one, for the signed-in admin, with the phone cut to its end.
create or replace function exit_pass_story(pass uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'by', case when s.phone is null then 'מנהל' else 'מנהל ראשי' end || ' · ' || right(e.phone, 4),
    'reason', e.reason,
    'at', e.created_at
  )
  from exit_passes e
  left join super_admins s on s.phone = e.phone
  where e.id = pass;
$$;
revoke execute on function exit_pass_story(uuid) from public, anon;
grant execute on function exit_pass_story(uuid) to authenticated;

-- The manager's signature on a day. Only sign_day writes here, so a signature can't be forged or moved.
create table if not exists day_signoffs (
  day date primary key,
  signed_by text not null,
  note text,
  -- What stood open when it was signed: counts, so the record stays true when those rows close later.
  open_items jsonb not null default '{}'::jsonb,
  signed_at timestamptz not null default now()
);
alter table day_signoffs enable row level security;
drop policy if exists "admin read day signoffs" on day_signoffs;
create policy "admin read day signoffs" on day_signoffs for select to authenticated using (true);
revoke all on table day_signoffs from anon;
revoke insert, update, delete, truncate on table day_signoffs from authenticated;

-- A day can be signed with something open only if the manager writes why. Stock under its minimum is a state, not a decision, so it doesn't stop a day.
create or replace function sign_day(target date, why text default null) returns day_signoffs
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  who text := actor_label();
  summary jsonb;
  faults_open int;
  requests_open int;
  names_open int;
  signed day_signoffs;
begin
  if who is null then raise exception 'צריך להיכנס למערכת'; end if;
  if target > today or target < today - 1 then raise exception 'אפשר לאשר רק את היום או את אתמול'; end if;
  summary := day_summary(target);
  faults_open := jsonb_array_length(summary->'faults');
  requests_open := jsonb_array_length(summary->'requests');
  names_open := jsonb_array_length(summary->'names');
  if faults_open + requests_open + names_open > 0 and coalesce(btrim(why), '') = '' then
    raise exception 'יש חריגות פתוחות. צריך לכתוב למה היום נסגר איתן';
  end if;
  insert into day_signoffs (day, signed_by, note, open_items)
    values (target, who, nullif(btrim(why), ''), jsonb_build_object('faults', faults_open, 'requests', requests_open, 'names', names_open))
    on conflict (day) do nothing
    returning * into signed;
  if signed.day is null then raise exception 'היום כבר אושר'; end if;
  return signed;
end $$;
revoke execute on function sign_day(date, text) from public, anon;
grant execute on function sign_day(date, text) to authenticated;
