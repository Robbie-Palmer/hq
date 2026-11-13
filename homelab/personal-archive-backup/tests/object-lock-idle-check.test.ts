import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const idleCheckScript = join(
  projectDirectory,
  "scripts/object-lock-idle-check.sh",
);

function runIdleCheck(environment: NodeJS.ProcessEnv) {
  return spawnSync("bash", [idleCheckScript], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: environment,
    timeout: 10_000,
  });
}

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "object-lock-idle-"));
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  writeFileSync(
    join(binDirectory, "systemctl"),
    `#!/usr/bin/env bash
set -eu
if [[ " $* " = *" --user show-environment "* ]]; then
  test "\${FAKE_USER_BUS:-missing}" = available
elif [[ " $* " = *" is-active user@"* ]]; then
  printf '%s\n' "\${FAKE_USER_MANAGER_STATE:-inactive}"
  test "\${FAKE_USER_MANAGER_STATE:-inactive}" = active
elif [[ " $* " = *" --user is-active personal-archive-backup.service "* ]]; then
  printf '%s\n' "\${FAKE_SERVICE_STATE:-inactive}"
  test "\${FAKE_SERVICE_STATE:-inactive}" = active
elif [[ " $* " = *" --user is-active personal-archive-backup.timer "* ]]; then
  printf '%s\n' "\${FAKE_TIMER_STATE:-inactive}"
  test "\${FAKE_TIMER_STATE:-inactive}" = active
elif [[ " $* " = *" --user is-enabled personal-archive-backup.timer "* ]]; then
  printf '%s\n' "\${FAKE_TIMER_ENABLED:-disabled}"
  test "\${FAKE_TIMER_ENABLED:-disabled}" = enabled
else
  exit 90
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(binDirectory, "pgrep"),
    String.raw`#!/usr/bin/env bash
exit "\${FAKE_PROCESS_RUNNING:-1}"
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(binDirectory, "hostname"),
    "#!/usr/bin/env bash\nprintf 'vector-development\\n'\n",
    { mode: 0o700 },
  );
  for (const command of ["systemctl", "pgrep", "hostname"]) {
    chmodSync(join(binDirectory, command), 0o700);
  }
  return {
    directory,
    environment: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
  };
}

test("accepts an inactive user manager as proof no user backup can run", () => {
  const fixture = createFixture();
  try {
    const result = runIdleCheck(fixture.environment);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.idle, true);
    assert.equal(proof.userManagerState, "inactive");
    assert.equal(proof.serviceState, "manager-inactive");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("fails closed when the active user manager cannot be queried", () => {
  const fixture = createFixture();
  try {
    const result = runIdleCheck({
      ...fixture.environment,
      FAKE_USER_MANAGER_STATE: "active",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /idle state is unproven/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects an active personal archive service", () => {
  const fixture = createFixture();
  try {
    const result = runIdleCheck({
      ...fixture.environment,
      FAKE_USER_BUS: "available",
      FAKE_SERVICE_STATE: "active",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /backup service is running/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
