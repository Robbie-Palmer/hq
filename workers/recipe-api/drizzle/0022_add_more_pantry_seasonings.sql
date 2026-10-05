insert into "ingredient" ("slug", "name", "category", "created_at", "updated_at")
values
  ('fajita-seasoning', 'fajita seasoning', 'spice', now(), now()),
  ('garlic-italian-seasoning', 'garlic Italian seasoning', 'spice', now(), now()),
  ('ground-ginger', 'ground ginger', 'spice', now(), now()),
  ('ground-white-pepper', 'ground white pepper', 'spice', now(), now()),
  ('medium-curry-powder', 'medium curry powder', 'spice', now(), now())
on conflict ("slug") do update
set "name" = excluded."name", "category" = excluded."category", "updated_at" = now();
