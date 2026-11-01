#!/usr/bin/env bash
set -euo pipefail

package_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tool="$package_root/scripts/check-migrations.sh"
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/bin" "$fixture_root/drizzle" "$fixture_root/scripts"
git -C "$fixture_root" init -q

cat > "$fixture_root/scripts/check-drizzle-migration-names.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "drizzle" ]]
touch .migration-name-check-ran
SCRIPT

cat > "$fixture_root/bin/pnpm" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "exec" && "$2" == "drizzle-kit" ]]
if [[ "$3" == "generate" && "${GENERATE_DRIFT:-}" == "1" ]]; then
  touch drizzle/0001_generated.sql
fi
SCRIPT

touch "$fixture_root/drizzle/0000_create_fixture.sql"
chmod +x \
  "$fixture_root/scripts/check-drizzle-migration-names.sh" \
  "$fixture_root/bin/pnpm"

(
  cd "$fixture_root"
  PATH="$fixture_root/bin:$PATH" "$tool"
)

[[ -f "$fixture_root/.migration-name-check-ran" ]]

if (
  cd "$fixture_root"
  GENERATE_DRIFT=1 PATH="$fixture_root/bin:$PATH" "$tool"
) 2> "$fixture_root/drift-error.log"; then
  echo "Expected migration drift to fail validation." >&2
  exit 1
fi

grep -q "Schema changes are missing a committed Drizzle migration." \
  "$fixture_root/drift-error.log"
