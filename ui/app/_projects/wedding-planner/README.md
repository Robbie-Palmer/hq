# Wedding planner project UI

This directory owns the Wedding planner browser product mounted at
`/wedding-planner` in the shared Next.js application. Public route files provide
Next.js metadata and route conventions, then delegate rendering here. The
`routes` directory maps stable URLs to wedding-owned workflows. Shared page,
form, table, empty, loading, and error patterns live under `components`.

`application` contains browser adapters and wedding-owned use cases.
`components` handles interaction and presentation. Business rules and the
canonical `WeddingPlan` model belong to `packages/wedding-planner-domain`.

`application/plan-codec.ts` is the boundary for saved plan text. It parses old
and current backups into `WeddingPlan`, while `WeddingPlanDraft` remains an
editor-only projection. Keep the `wedding-planner:plan:v2` key and legacy plan
imports compatible when changing this boundary.

Private workflow URLs are `/wedding-planner/readiness`, `/guests`,
`/accommodation`, `/seating`, `/music`, and `/exports`. Accommodation has
stable child URLs for sharing choices, inventory, costs, and the calculated
room plan. Guest selection uses the `guest` query parameter so refresh and
browser history restore the selected record.
