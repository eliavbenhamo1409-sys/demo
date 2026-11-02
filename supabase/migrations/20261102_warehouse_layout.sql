-- The floor of the /3d page: one document of objects and their geometry, never stock.
-- One row, so a save is atomic and raises one realtime event. A save names the version it started
-- from, so it can't overwrite a newer one.
-- Scoped to `authenticated`: the admin signs in and the worker app runs as `anon`, which gets nothing.
-- No delete: without the row the page falls back to the code default with editing off.
create table warehouse_layout (
  id text primary key default 'main' check (id = 'main'),
  doc jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create trigger warehouse_layout_touch before update on warehouse_layout for each row execute function touch_updated_at();

alter table warehouse_layout enable row level security;
create policy "admin read layout" on warehouse_layout for select to authenticated using (true);
create policy "admin add layout" on warehouse_layout for insert to authenticated with check (true);
create policy "admin edit layout" on warehouse_layout for update to authenticated using (true) with check (true);
alter publication supabase_realtime add table warehouse_layout;

-- Editing needs a saved row to compare versions against, so the floor starts as one.
-- The same objects as DEFAULT_OBJECTS in src/lib/map3d/layout.ts.
insert into warehouse_layout (doc) values ('{"objects": [
  {"id":"A-1","kind":"rack","name":"מתקן A-1","x":8,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"A-2","kind":"rack","name":"מתקן A-2","x":8,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"A-3","kind":"rack","name":"מתקן A-3","x":8,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"A-4","kind":"rack","name":"מתקן A-4","x":8,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"A-5","kind":"rack","name":"מתקן A-5","x":8,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"B-1","kind":"rack","name":"מתקן B-1","x":17,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"B-2","kind":"rack","name":"מתקן B-2","x":17,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"B-3","kind":"rack","name":"מתקן B-3","x":17,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"B-4","kind":"rack","name":"מתקן B-4","x":17,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"B-5","kind":"rack","name":"מתקן B-5","x":17,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"C-1","kind":"rack","name":"מתקן C-1","x":26,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"C-2","kind":"rack","name":"מתקן C-2","x":26,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"C-3","kind":"rack","name":"מתקן C-3","x":26,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"C-4","kind":"rack","name":"מתקן C-4","x":26,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"C-5","kind":"rack","name":"מתקן C-5","x":26,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"D-1","kind":"rack","name":"מתקן D-1","x":35,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"D-2","kind":"rack","name":"מתקן D-2","x":35,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"D-3","kind":"rack","name":"מתקן D-3","x":35,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"D-4","kind":"rack","name":"מתקן D-4","x":35,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"D-5","kind":"rack","name":"מתקן D-5","x":35,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"E-1","kind":"rack","name":"מתקן E-1","x":44,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"E-2","kind":"rack","name":"מתקן E-2","x":44,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"E-3","kind":"rack","name":"מתקן E-3","x":44,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"E-4","kind":"rack","name":"מתקן E-4","x":44,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"E-5","kind":"rack","name":"מתקן E-5","x":44,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"G-1","kind":"rack","name":"מתקן G-1","x":53,"z":10,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"G-2","kind":"rack","name":"מתקן G-2","x":53,"z":23,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"G-3","kind":"rack","name":"מתקן G-3","x":53,"z":33,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"G-4","kind":"rack","name":"מתקן G-4","x":53,"z":43,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"G-5","kind":"rack","name":"מתקן G-5","x":53,"z":53,"w":6.4,"d":3.4,"h":5.4,"levels":4},
  {"id":"M-01","kind":"machine","name":"מסור דו־ראשי לפרופילים","x":72,"z":7,"w":6,"d":4,"h":2.3,"note":"חיתוך פרופילים לפי מידה","model":"saw"},
  {"id":"M-02","kind":"machine","name":"מרכז עיבוד CNC","x":83,"z":7,"w":6,"d":4,"h":2.6,"note":"קידוח וכרסום פרופילים ולוחות","model":"cnc"},
  {"id":"M-03","kind":"machine","name":"מכבש כיפוף לוחות","x":93,"z":7,"w":5,"d":2,"h":2.4,"note":"כיפוף לוחות","model":"press"},
  {"id":"M-04","kind":"machine","name":"מסור חיתוך ללוחות","x":72,"z":19,"w":6,"d":4,"h":2.3,"note":"חיתוך לוחות ופלטות לפי מידה","model":"saw"},
  {"id":"M-05","kind":"machine","name":"לייזר סיבים 6 קילוואט","x":83,"z":19,"w":6,"d":4,"h":2.6,"note":"חיתוך לוחות עד 20 מ״מ","model":"cnc"},
  {"id":"M-06","kind":"machine","name":"גיליוטינה 3 מטר","x":93,"z":19,"w":5,"d":2,"h":2.4,"note":"גזירת לוחות עד 6 מ״מ","model":"press"},
  {"id":"F-01","kind":"floor","name":"אחסון רצפה F-01","x":8,"z":16.5,"w":6,"d":3,"h":1.1},
  {"id":"F-02","kind":"floor","name":"אחסון רצפה F-02","x":21,"z":16.5,"w":7,"d":2.7,"h":1.1},
  {"id":"F-03","kind":"floor","name":"אחסון רצפה F-03","x":51,"z":3,"w":7,"d":2.6,"h":0.9},
  {"id":"F-04","kind":"floor","name":"גלילי אלומיניום F-04","x":35,"z":16.5,"w":8,"d":3.4,"h":1.4},
  {"id":"F-05","kind":"floor","name":"גלילים צבועים F-05","x":48,"z":16.5,"w":6,"d":3.4,"h":1.4},
  {"id":"Z-01","kind":"zone","name":"קליטת סחורה","x":8,"z":3,"w":11,"d":4,"h":0.2},
  {"id":"Z-02","kind":"zone","name":"הזמנות פתוחות","x":23,"z":3,"w":11,"d":4,"h":0.2},
  {"id":"Z-03","kind":"zone","name":"אריזה ומשלוח","x":38,"z":3,"w":11,"d":4,"h":0.2}
]}'::jsonb);
