#!/usr/bin/env bash
set -euo pipefail

# One-time bootstrap for Basic Memory on the Mac mini hub.
# Installs the Python toolchain, Basic Memory CLI, and registers
# the shared knowledge space as a project.

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_NAME="knowledge"
# renovate: datasource=pypi depName=basic-memory versioning=pep440
BM_VERSION="0.22.1"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "bootstrap.sh must run on the macOS hub (Mac mini)." >&2
  exit 1
fi

require_command brew

# 1. Install uv (Python package manager) ----------------------------------
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv via Homebrew"
  brew install uv
fi

# 2. Install Basic Memory --------------------------------------------------
if ! command -v bm >/dev/null 2>&1; then
  echo "Installing basic-memory ${BM_VERSION} via uv tool"
  uv tool install --no-build "basic-memory==${BM_VERSION}"
fi

# Verify installation
if ! bm --version >/dev/null 2>&1; then
  echo "basic-memory installation failed" >&2
  exit 1
fi
echo "Basic Memory $(bm --version 2>/dev/null || echo '(installed)')"

# 3. Register the knowledge project ----------------------------------------
KNOWLEDGE_DIR="${HOME}/knowledge"

if [[ ! -d "$KNOWLEDGE_DIR" ]]; then
  echo "Knowledge directory does not exist at $KNOWLEDGE_DIR" >&2
  echo "Run the SilverBullet bootstrap first to create it." >&2
  exit 1
fi

# Check if project is already registered (exact match on first column)
existing_project="$(bm project list 2>/dev/null | awk -v name="$PROJECT_NAME" '$1 == name' || true)"
if [[ -z "$existing_project" ]]; then
  echo "Registering knowledge project at $KNOWLEDGE_DIR"
  bm project add "$PROJECT_NAME" "$KNOWLEDGE_DIR"
  bm project default "$PROJECT_NAME"
else
  echo "Knowledge project already registered"
  bm project default "$PROJECT_NAME" 2>/dev/null || true
fi

# 4. Verify ----------------------------------------------------------------
echo ""
echo "Basic Memory is ready."
echo "  Project: $PROJECT_NAME ($KNOWLEDGE_DIR)"
echo "  MCP:     bm mcp --project $PROJECT_NAME"
echo ""
echo "To connect an agent:"
echo "  Claude Code:  claude mcp add basic-memory -- bm mcp --project $PROJECT_NAME"
echo "  Codex:        add to ~/.codex/config.toml:"
echo "                  [mcp_servers.basic-memory]"
echo "                  command = \"bm\""
echo "                  args = [\"mcp\", \"--project\", \"$PROJECT_NAME\"]"
echo "  opencode:     add to ~/.config/opencode/config.json:"
echo "                  {\"mcp\":{\"basic-memory\":{\"command\":\"bm\",\"args\":[\"mcp\",\"--project\",\"$PROJECT_NAME\"]}}}"
echo ""
echo "To search notes:"
echo "  bm tool search-notes \"query\""
