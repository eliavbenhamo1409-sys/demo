-- The object on the map a fault sits on, so a machine can carry a report with no product behind it.
-- Plain text holding the object's code: the layout is one document, so there is no row to reference,
-- and a report stays readable after its object is removed.
alter table faults add column asset text;
