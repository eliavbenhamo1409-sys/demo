-- A fault can be handed to one worker with an instruction, from the overview's walk through the faults.
-- The worker sees it on their phone and closes it there with what was done. Additive: the code before this never sets assigned_to.

alter table faults
  add column if not exists assigned_to uuid references workers(id) on delete set null,
  add column if not exists instruction text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text;

comment on column faults.assigned_to is 'The worker the fault was handed to; it shows on their phone until it closes.';
comment on column faults.instruction is 'What the manager asked the worker to do; required while assigned_to is set.';
comment on column faults.assigned_at is 'When the fault was handed on, or its instruction last changed. Stamped by faults_stamp_resolution.';
comment on column faults.assigned_by is 'Who handed it on (actor_label). Stamped by faults_stamp_resolution.';

create index if not exists faults_assigned_to_idx on faults (assigned_to);

create or replace function faults_stamp_resolution() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;
