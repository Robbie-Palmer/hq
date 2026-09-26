import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const homelabDirectory = fileURLToPath(new URL("..", import.meta.url));
const backupScript = join(
  homelabDirectory,
  "scripts/remote-development-workspace-backup",
);
const restoreScript = join(
  homelabDirectory,
  "scripts/remote-development-workspace-restore",
);
const exportScript = join(
  homelabDirectory,
  "scripts/remote-development-workspace-export",
);
const committedBackupExcludes = join(
  homelabDirectory,
  "remote-development-backup/backup-excludes.txt",
);
const committedExportExcludes = join(
  homelabDirectory,
  "remote-development-backup/export-excludes.txt",
);

interface Fixture {
  directory: string;
  source: string;
  config: string;
  status: string;
  calls: string;
  environment: NodeJS.ProcessEnv;
}

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "workspace-backup-"));
  const source = join(directory, "source");
  const config = join(directory, "config");
  const status = join(directory, "status.json");
  const password = join(directory, "password");
  const calls = join(directory, "restic-calls");
  const repositoryMarker = join(directory, "repository-initialized");
  const fakeRestic = join(directory, "restic");
  mkdirSync(join(source, "home/.t3"), { recursive: true });
  mkdirSync(join(source, "workspaces/repository"), { recursive: true });
  writeFileSync(join(source, "home/.t3/thread.json"), "thread\n");
  writeFileSync(join(source, "workspaces/repository/code.ts"), "code\n");
  writeFileSync(password, "test-password\n", { mode: 0o600 });
  writeFileSync(
    config,
    [
      "WORKSPACE_ID=operator",
      "DESTINATION_PROVIDER=cloudflare-r2",
      `BACKUP_SOURCE=${source}`,
      `BACKUP_EXCLUDES_FILE=${committedBackupExcludes}`,
      `BACKUP_STATUS_FILE=${status}`,
      `BACKUP_PASSWORD_FILE=${password}`,
      "MAXIMUM_AGE_SECONDS=129600",
      "KEEP_HOURLY=24",
      "KEEP_DAILY=14",
      "KEEP_WEEKLY=8",
      "KEEP_MONTHLY=12",
      "",
    ].join("\n"),
  );
  writeFileSync(
    fakeRestic,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_RESTIC_CALLS"
case "$1" in
  snapshots)
    test -f "$FAKE_REPOSITORY_MARKER"
    ;;
  init)
    touch "$FAKE_REPOSITORY_MARKER"
    ;;
  backup)
    test "\${FAKE_BACKUP_FAILURE:-0}" = 0 || exit 42
    ;;
  check)
    test "\${FAKE_CHECK_FAILURE:-0}" = 0 || exit 43
    ;;
  forget)
    test "\${FAKE_RETENTION_FAILURE:-0}" = 0 || exit 44
    rm -f -- "\${FAKE_EXPIRED_SNAPSHOT:-/does-not-exist}"
    ;;
  restore)
    target=
    for argument in "$@"; do
      case "$argument" in
        --target=*) target=\${argument#--target=} ;;
      esac
    done
    test -n "$target"
    mkdir -p "$target$FAKE_RESTORE_SOURCE/home/.t3"
    mkdir -p "$target$FAKE_RESTORE_SOURCE/workspaces"
    ;;
  *)
    exit 90
    ;;
esac
`,
  );
  chmodSync(fakeRestic, 0o700);

  return {
    directory,
    source,
    config,
    status,
    calls,
    environment: {
      ...process.env,
      WORKSPACE_BACKUP_CONFIG: config,
      RESTIC_BIN: fakeRestic,
      RESTIC_REPOSITORY: `local:${join(directory, "repository")}`,
      FAKE_RESTIC_CALLS: calls,
      FAKE_REPOSITORY_MARKER: repositoryMarker,
      FAKE_RESTORE_SOURCE: source,
    },
  };
}

function run(
  script: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync("bash", [script, ...args], {
    cwd: homelabDirectory,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });
}

test("backup includes durable workspace paths and prunes expired snapshots", () => {
  const fixture = createFixture();
  const expiredSnapshot = join(fixture.directory, "expired-snapshot");
  writeFileSync(expiredSnapshot, "old\n");

  try {
    const result = run(backupScript, [], {
      ...fixture.environment,
      FAKE_EXPIRED_SNAPSHOT: expiredSnapshot,
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, new RegExp(`backup .* ${fixture.source.replaceAll("/", "\\/")}$`, "m"));
    assert.match(calls, /--exclude-file=.*backup-excludes\.txt/);
    assert.match(
      calls,
      /forget .*--keep-hourly=24 .*--keep-daily=14 .*--keep-weekly=8 .*--keep-monthly=12 --prune/,
    );
    assert.equal(spawnSync("test", ["-e", expiredSnapshot]).status, 1);
    assert.doesNotMatch(
      readFileSync(committedBackupExcludes, "utf8"),
      /t3-code\/home\/\.t3|t3-code\/workspaces$/m,
    );
    assert.match(
      readFileSync(committedBackupExcludes, "utf8"),
      /\/srv\/remote-development\/t3-code-cache/,
    );
    const status = JSON.parse(readFileSync(fixture.status, "utf8"));
    assert.equal(status.state, "success");
    assert.equal(status.failedStep, null);
    assert.equal(status.exitCode, 0);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("failed uploads expose a safe machine-readable failure", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.directory, "repository-initialized"), "ready\n");

  try {
    const result = run(backupScript, [], {
      ...fixture.environment,
      FAKE_BACKUP_FAILURE: "1",
    });
    assert.equal(result.status, 42);
    assert.equal(result.stderr.trim(), "workspace backup upload failed");
    const status = JSON.parse(readFileSync(fixture.status, "utf8"));
    assert.equal(status.state, "failed");
    assert.equal(status.failedStep, "backup");
    assert.equal(status.exitCode, 42);
    assert.equal(JSON.stringify(status).includes(fixture.source), false);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("a corrupt snapshot fails the integrity step before retention", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.directory, "repository-initialized"), "ready\n");

  try {
    const result = run(backupScript, [], {
      ...fixture.environment,
      FAKE_CHECK_FAILURE: "1",
    });
    assert.equal(result.status, 43);
    const status = JSON.parse(readFileSync(fixture.status, "utf8"));
    assert.equal(status.failedStep, "check");
    assert.doesNotMatch(readFileSync(fixture.calls, "utf8"), /^forget /m);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("restore requires an empty target and checks durable paths", () => {
  const fixture = createFixture();
  const target = join(fixture.directory, "restore");

  try {
    const first = run(restoreScript, [target], fixture.environment);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(
      readFileSync(fixture.calls, "utf8").includes("restore latest"),
      true,
    );

    const second = run(restoreScript, [target], fixture.environment);
    assert.equal(second.status, 1);
    assert.equal(second.stderr.trim(), "restore target must be empty");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("portable export omits credentials and retains ordinary files", () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-export-"));
  const source = join(directory, "workspace");
  const archive = join(directory, "workspace.tar.gz");
  mkdirSync(join(source, "home/.ssh"), { recursive: true });
  mkdirSync(join(source, "home/.codex/sessions"), { recursive: true });
  mkdirSync(join(source, "home/.t3/userdata/secrets"), { recursive: true });
  mkdirSync(join(source, "workspaces/repository"), { recursive: true });
  writeFileSync(join(source, "home/.ssh/id_ed25519"), "private-key\n");
  writeFileSync(join(source, "home/.codex/auth.json"), "token\n");
  writeFileSync(
    join(source, "home/.t3/userdata/secrets/server-signing-key.bin"),
    "signing-key\n",
  );
  writeFileSync(join(source, "home/.codex/sessions/thread.jsonl"), "thread\n");
  writeFileSync(join(source, "workspaces/repository/code.ts"), "code\n");
  writeFileSync(join(source, "workspaces/repository/.env"), "API_TOKEN=secret\n");

  try {
    const result = run(exportScript, [source, archive], {
      ...process.env,
      WORKSPACE_EXPORT_EXCLUDES: committedExportExcludes,
    });
    assert.equal(result.status, 0, result.stderr);
    const listing = spawnSync("tar", ["-tzf", archive], {
      encoding: "utf8",
    });
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /home\/\.codex\/sessions\/thread\.jsonl/);
    assert.match(listing.stdout, /workspaces\/repository\/code\.ts/);
    assert.doesNotMatch(
      listing.stdout,
      /auth\.json|id_ed25519|server-signing-key|home\/\.ssh|\/\.env$/m,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
