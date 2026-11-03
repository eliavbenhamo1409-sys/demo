-- A fault no longer closes on a press: the database refuses it without a written resolution. Goes out with the code that asks for one.

create or replace function faults_stamp_resolution() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolution := nullif(btrim(new.resolution), '');
    if new.resolution is null then raise exception 'צריך לכתוב מה נעשה כדי לסגור תקלה'; end if;
    new.resolved_by := actor_label();
  elsif new.status = 'open' and old.status = 'resolved' then
    new.resolution := null;
    new.resolved_by := null;
  else
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end $$;
