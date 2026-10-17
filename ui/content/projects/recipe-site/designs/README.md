# Recipe Site, product designs (mid-fi)

Vendored design artifacts for the Recipe Site, exported from
[Claude Design](https://claude.ai/design) (project id
`019dd0cd-1a77-717c-b0ec-a6e1c969092f`). These **prototypes** document the
intended look and behaviour of the full product. Keep them in version control
alongside the PRD (`../index.mdx`), PDRs (`../pdrs/`), and ADRs (`../adrs/`).

The mid-fi pass covers 18 surfaces across desktop + mobile: recipe list,
recipe read/cook, scan/import, kitchen (pantry + freezer), planning and shopping,
share, cookbooks, profile, diet, a shared-household system (setup, settings,
pantry, plan, leftovers, activity), recipe lineage/provenance, cook log,
logged-out home + discover feed, onboarding, recommendations inbox,
notifications, a settings hub, and the planning/shopping navigation model.

## What's here

- `mid-fi/`, the design source. `system.css` holds the design tokens (the warm
  paper palette + Caveat / Kalam / JetBrains Mono type); `system.jsx` holds the
  shared components and sample data; one `.jsx` per screen.
- `design-canvas.jsx`, `tweaks-panel.jsx` are the canvas/tooling the mid-fi
  `app.jsx` assembles the artboards into.
- `Recipe Site Mid-fi.html` is the runnable entry point. Open it in a browser
  (it loads React + Babel from a CDN and compiles the `.jsx` in place) to view
  every screen. It references the files above by relative path.
- `.design-canvas.state.json`, canvas section metadata.

The wireframes pass and the reference screenshots that were uploaded into the
design tool are intentionally not vendored. Only the mid-fi pass is kept.

## How it's surfaced on the site

The interactive prototype is embedded inline in the project page (see the
**Product Design** section of `../index.mdx`) via a self-contained build served
from `ui/public/recipe-site-design/standalone.html`. That served file is the
compiled "dist" of this source; this directory is the editable, diffable source.

This folder is excluded from Biome (`ui/biome.json`). It is vendored prototype
source, not part of the app's lint/format/typecheck surface.

## Next steps (deferred)

Breaking these designs into prioritised epics/tasks, and recreating individual
screens pixel-perfectly as native React components remain follow-up steps.
This change only vendors and embeds the designs.
