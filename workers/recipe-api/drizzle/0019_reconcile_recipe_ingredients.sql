insert into "ingredient" ("slug", "name", "category", "created_at", "updated_at")
values
  ('chilli-oil', 'chilli oil', 'oil-fat', now(), now()),
  ('maple-syrup', 'maple syrup', 'condiment', now(), now())
on conflict ("slug") do update
set "name" = excluded."name", "category" = excluded."category", "updated_at" = now();
--> statement-breakpoint
update "recipe"
set
  "body" = replace(
    replace(
      replace("body", '"neutral-oil"', '"vegetable-oil"'),
      '"rice-vinegar"',
      '"rice-wine-vinegar"'
    ),
    '"tomato-pure"', '"tomato-puree"'
  ),
  "updated_at" = now()
where
  "body" like '%"neutral-oil"%'
  or "body" like '%"rice-vinegar"%'
  or "body" like '%"tomato-pure"%';
