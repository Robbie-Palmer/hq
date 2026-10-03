insert into "ingredient" ("slug", "name", "category", "created_at", "updated_at")
values
  ('dried-bay-leaves', 'dried bay leaves', 'herb', now(), now()),
  ('dried-chives', 'dried chives', 'herb', now(), now()),
  ('dried-dill', 'dried dill', 'herb', now(), now()),
  ('dried-tarragon', 'dried tarragon', 'herb', now(), now()),
  ('ground-allspice', 'ground allspice', 'spice', now(), now()),
  ('ground-cinnamon', 'ground cinnamon', 'spice', now(), now()),
  ('ground-nutmeg', 'ground nutmeg', 'spice', now(), now()),
  ('harissa-seasoning', 'harissa seasoning', 'spice', now(), now()),
  ('mixed-spice', 'mixed spice', 'spice', now(), now()),
  ('whole-cloves', 'whole cloves', 'spice', now(), now())
on conflict ("slug") do update
set "name" = excluded."name", "category" = excluded."category", "updated_at" = now();
