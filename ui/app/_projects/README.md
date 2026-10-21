# Project-owned UI

Each directory below this one contains browser code owned by one logical
project and mounted by the shared `robbiepalmer.me` Next.js application.
Project profiles use the `project-ui` component kind and resolve the path from
the project ID.

The shared public routes should remain thin adapters. Project-owned UI keeps its
project identity and source path if a custom domain later serves the same
frontend bundle.
