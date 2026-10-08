# Agent Auth MCP server

This package exposes a Better Auth Agent Auth client through a standard stdio
MCP server. It runs on Linux, macOS, and Windows with Node.js 22 or later.

The server reuses the newest active connection whose provider, mode, and
capabilities match the request. It starts the normal approval flow when no
connection matches. Constrained capability requests always start a new flow
because the pinned Agent Auth client does not persist enough constraint detail
to prove that an existing grant is equivalent.

## Install

Install the package from a repository checkout with Node.js 22 or later:

```bash
npm install --global ./packages/agent-auth-mcp
```

The package exposes the `agent-auth-mcp` executable. MCP hosts may also invoke
`src/cli.mjs` with Node.js without a global installation.

## Configure an MCP host

Point the host at `agent-auth-mcp` and pass one or more providers with `--url`.
The exact configuration file differs by MCP host. This generic example shows
the required stdio process fields:

```json
{
  "command": "agent-auth-mcp",
  "args": [
    "--storage-dir",
    "/path/to/private/agent-auth-state",
    "--host-name",
    "My development agent",
    "--url",
    "https://example.com"
  ]
}
```

Set `AGENT_AUTH_ENCRYPTION_KEY` in the environment inherited by the MCP
process. Do not put the key in a committed host configuration. The server
creates the storage directory and its private subdirectories with mode `0700`
on platforms that support POSIX permissions.

Available arguments are:

- `--url <url>`, repeatable for fixed provider URLs
- `--directory-url <url>`, for provider discovery
- `--storage-dir <path>`
- `--host-name <name>`
- `--no-browser`, to print approval URLs without opening them

The corresponding environment variables are `AGENT_AUTH_URLS`,
`AGENT_AUTH_DIRECTORY_URL`, `AGENT_AUTH_STORAGE_DIR`, `AGENT_AUTH_HOST_NAME`,
and `AGENT_AUTH_NO_BROWSER=1`.
