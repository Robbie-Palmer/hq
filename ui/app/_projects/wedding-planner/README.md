# Wedding planner project UI

This directory owns the Wedding planner browser product mounted at
`/wedding-planner` in the shared Next.js application. Public route files provide
Next.js metadata and route conventions, then delegate rendering here.

`application` contains browser adapters and wedding-owned use cases.
`components` handles interaction and presentation. Business rules and the
canonical `WeddingPlan` model belong to `packages/wedding-planner-domain`.

`application/plan-codec.ts` is the boundary for saved plan text. It parses old
and current backups into `WeddingPlan`, while `WeddingPlanDraft` remains an
editor-only projection. Keep the `wedding-planner:plan:v2` key and legacy plan
imports compatible when changing this boundary.
