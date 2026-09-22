# Project Guide for Coding Agents

## Build System

This repo uses [mise](https://mise.jdx.dev/) with its experimental monorepo layout. Tasks live in
`.mise.toml` and per-project `mise.toml` files; discover them with `mise task --all`. Always run
tasks through mise (`mise //:task-name`, `mise //project:task-name`). Never run raw `pnpm run`/`npm run`.

If mise is unavailable in your environment, fall back to pnpm inside `ui/` (`pnpm install`,
`pnpm typecheck`, `pnpm lint`, `pnpm test`). The build requires `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`
to be set; any non-empty value works for verification builds:

```bash
NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH=placeholder pnpm build
```

After changing frontend code, run `mise //ui:lint`. The `@shadcn/lint` policy lives in
`ui/.oxlintrc.json`; keep recipe-specific color and class guidance scoped to the recipe overrides.

## Agent-Friendly Markdown

Every major page has a plain-Markdown twin at the same URL with a `.md` suffix (e.g.
`/projects.md`), indexed at `/llms.txt`. Prefer these when fetching page content.

Idea pages explain concepts independently of the projects or initiatives that use them.
Keep them domain-agnostic unless the concept itself belongs to a specific domain. Do not
add project or initiative links to idea-page prose; link from projects and initiatives to ideas.

## Work Graph

When asked to take or update Work Graph tickets, read
`.agents/skills/work-graph/SKILL.md`. Run `work-graph prime` for the current short workflow. The
CLI can infer lease fencing fields for ticket commands, so do not carry lease UUIDs through the
conversation unless a recovery or audit needs them.

## Protected Preview QA

PR previews remain behind Cloudflare Access. Agent runtimes receive the preview-only
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` credentials from their secret store. For HTTP
inspection, use the allowlisted wrapper so the credentials can only be sent to a canonical
`pr-<number>` Pages hostname:

```bash
mise run //:preview:fetch -- https://pr-123.personal-site-bu5.pages.dev/projects.md
```

For browser automation, configure those same values as the
`CF-Access-Client-Id` and `CF-Access-Client-Secret` extra HTTP headers before navigating to the
preview. Scope the headers to the canonical preview hostname; never type, log, or commit either
credential.

## Sandboxed GitHub Commands

GitHub authentication checks and operations can report invalid credentials when run inside the
agent sandbox even though the host session is authenticated. If `gh auth status`, `git push`, or
another required GitHub command fails in the sandbox, rerun the actual command with elevated
approval. Do not ask the user to reauthenticate unless the elevated command also reports an
authentication error.
