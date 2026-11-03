-- A closed fault's line in the day's record says what was done, beside the product it touched.
-- Patched in place, so the long function keeps one home. Days already closed keep what they stored.

do $$
declare
  before text := pg_get_functiondef('day_summary(date)'::regprocedure);
  after text := replace(before,
    $old$select 'fault_resolved', f.resolved_at, f.description, p.name, null, null$old$,
    $new$select 'fault_resolved', f.resolved_at, f.description, nullif(concat_ws(' · ', p.name, f.resolution), ''), null, null$new$);
begin
  if after = before then raise exception 'day_summary: the fault line was not found'; end if;
  execute after;
end $$;
