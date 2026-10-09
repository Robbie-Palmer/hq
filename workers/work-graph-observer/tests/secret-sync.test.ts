import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("maps observer Doppler keys to non-reserved masked GitHub secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "observer-secret-sync-"));
  try {
    const fixture = {
      GITHUB_WEBHOOK_SECRET: {
        computed: "fixture-only",
        computedVisibility: "masked",
      },
      GITHUB_ALLOWED_REPOSITORIES: {
        computed: '["example/site"]',
        computedVisibility: "unmasked",
      },
      GITHUB_ALLOWED_INSTALLATION_IDS: {
        computed: "[42]",
        computedVisibility: "unmasked",
      },
      WORK_GRAPH_HYPERDRIVE_ID: {
        computed: "fixture-id",
        computedVisibility: "masked",
      },
    };
    await writeFile(join(directory, "fixture.json"), JSON.stringify(fixture));
    await writeFile(
      join(directory, "doppler"),
      '#!/bin/bash\ncat "$SYNC_TEST_DIRECTORY/fixture.json"\n',
      { mode: 0o700 },
    );
    await writeFile(
      join(directory, "gh"),
      `#!/bin/bash
set -eu
if [[ "$2" == "list" ]]; then
  echo '[]'
else
  printf '%s %s %s\\n' "$1" "$2" "$3" >> "$SYNC_TEST_DIRECTORY/calls"
fi
`,
      { mode: 0o700 },
    );
    execFileSync(
      "bash",
      [
        resolve("../../scripts/sync-doppler-github-envs.sh"),
        "production-work-graph",
      ],
      {
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          SYNC_TEST_DIRECTORY: directory,
        },
      },
    );
    const calls = await readFile(join(directory, "calls"), "utf8");
    for (const suffix of [
      "WEBHOOK_SECRET",
      "ALLOWED_REPOSITORIES",
      "ALLOWED_INSTALLATION_IDS",
    ]) {
      expect(calls).toContain(`secret set OBSERVER_${suffix}`);
      expect(calls).not.toContain(`secret set GITHUB_${suffix}`);
      expect(calls).not.toContain(`variable set OBSERVER_${suffix}`);
    }
    expect(calls).toContain("secret set WORK_GRAPH_HYPERDRIVE_ID");
    expect(calls).not.toContain("fixture-only");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
