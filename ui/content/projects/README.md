# Project Authoring Guide

This directory contains the content for the "Projects" section of the site.

## Directory Structure

Each project is a subdirectory named after its slug (e.g., `personal-knowledge-graph`). Inside each directory:

1. `index.mdx`: The main project content and metadata (in frontmatter).
2. `adrs/`: A directory containing Architecture Decision Records (ADRs) as `.mdx` files.
3. `pitch.mdx`: An optional pitch deck shown before the overview.

Example:

```text
content/projects/
└── personal-knowledge-graph/
    ├── index.mdx
    ├── pitch.mdx
    └── adrs/
        ├── 001-monorepo.mdx
        └── 002-rendering-strategy.mdx
```

## Project Metadata (index.mdx)

Define metadata in the frontmatter of `index.mdx`:

```yaml
---
title: "Project Title"
description: "Short description for cards and SEO."
date: "2025-11-02"
updated: "2025-12-15" # Optional
tech_stack:
  - "Next.js"
  - "TypeScript"
  - "Tailwind CSS"
repo_url: "https://github.com/..." # Optional
demo_url: "https://demo..." # Optional
product_url: "https://product..." # Optional
paper_title: "Published paper title" # Required with paper_url; labels the graph node
paper_url: "https://doi.org/..." # Optional, published research paper
role: "terminal-industries" # Optional - link to job role slug
initiatives: # Optional - projects may contribute to more than one initiative
  - "personalized-medicine"
---

# Overview

Write your project overview here using MDX...
```

## Pitch decks

Add `pitch.mdx` when a project benefits from a shorter opening explanation. The file becomes the default project
tab and also creates `/projects/{slug}/deck` and `/projects/{slug}/deck.md`.

```mdx
---
title: "Project pitch"
description: "A short description for the deck route"
---

# Opening slide

One clear idea per slide.

---

## Next slide

<PitchColumns>
  <PitchColumn>Left column</PitchColumn>
  <PitchColumn>Right column</PitchColumn>
</PitchColumns>

<PitchStep index={0}>First animated reveal</PitchStep>
<PitchStep index={1}>Second animated reveal</PitchStep>

<PitchNotes>Speaker notes stay out of Markdown, but remain public in the HTML.</PitchNotes>
```

Root thematic breaks split slides. `PitchStep` creates a Reveal fragment, and an optional `index` fixes its order.
Decks may also use `Mermaid`, fenced code blocks with Shiki highlighting, and project-specific components registered
in the pitch component map. Keep speaker notes free of secrets.

### Role Field

The `role` field is optional and links a project to a job role where it was created. The value should be the
slug of the job role (normalized company name). For example:

- `"terminal-industries"` for Terminal Industries
- `"bestomer"` for Bestomer
- `"confluent"` for Confluent

When specified, the role will be displayed as a badge on the project card and detail page, linking to the
specific job role on the experience page.

### Initiatives field

The `initiatives` field links a project to one or more larger bodies of work. Define each initiative as an MDX file in
`content/initiatives/`, then reference its filename without the extension. Initiative links do not depend on roles, so
one initiative can connect projects from different employers or personal work.

### Inheriting ADRs

Projects inherit ADRs by creating explicit stub files inside the project's `adrs/` directory.
This keeps inherited and local decisions interleaved in the same ordered index space.

Example inherited stub:

```yaml
---
inherits_from: "personal-knowledge-graph:002-react"
---
```

Rules:

- Inherited stubs are derived from source ADR content and metadata.
- Inherited stubs may include markdown body content as project-specific notes.
- `inherits_adrs` in project frontmatter is deprecated, and forbidden.
- Use ADR-level `supersedes` only when replacing an inherited decision.
- `supersedes` should reference ADRs in the current project's ADR context.

Inherited ADRs are rendered inside the child project's ADR routes (`/projects/{child}/adrs/{slug}`) with
child-context numbering. The detail page shows source-project attribution, a summary of the source ADR,
and any project-specific notes from the stub file body.

Note: ADR slugs must be unique within a project's effective ADR context (local + inherited). Duplicate slugs
in a single project context fail validation.

## ADR Format

ADRs are standard MDX files in the `adrs/` subdirectory. The filename should be numbered (e.g., `001-decision-name.mdx`).

**Frontmatter:**

```yaml
---
title: "ADR Title"
status: "Accepted" # "Proposed" | "Accepted" | "Rejected" | "Deprecated"
date: "YYYY-MM-DD"
supersedes: "project-slug:adr-slug" # Optional, e.g. "personal-knowledge-graph:013-dependabot"
---
```
