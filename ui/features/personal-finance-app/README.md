# Personal Finance web feature

This directory owns the Personal Finance browser product currently mounted at
`/assettracker` in the shared `robbiepalmer.me` Next.js application.

The `routes` modules are the feature's public entry points. Files under
`ui/app/assettracker` provide Next.js metadata and route conventions, then
delegate rendering here. Product components, domain logic, browser persistence,
demo data, and unit tests stay inside this directory.

Keep the `assettracker:data:v1` browser storage key compatible when changing
the host or adding a dedicated domain. A separate deployment does not require a
new project or component identity.
