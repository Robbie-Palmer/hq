import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const stateExportScript = join(
  homelabDirectory,
  "scripts/remote-development-workspace-state-export",
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
  const staging = join(directory, "backup-state/staging");
  const password = join(directory, "password");
  const credentials = join(directory, "restic.env");
  const calls = join(directory, "restic-calls");
  const repositoryMarker = join(directory, "repository-initialized");
  const fakeRestic = join(directory, "restic");
  const fakeStateExport = join(directory, "state-export");
  mkdirSync(join(source, "home/.t3/userdata"), { recursive: true });
  mkdirSync(join(source, "workspaces/repository"), { recursive: true });
  writeFileSync(join(source, "home/.t3/userdata/statev2.sqlite"), "state\n");
  writeFileSync(join(source, "home/.t3/userdata/server-owner.sqlite"), "owner\n");
  writeFileSync(join(source, "home/.t3/userdata/settings.json"), "{}\n");
  writeFileSync(join(source, "workspaces/repository/code.ts"), "code\n");
  writeFileSync(password, "test-password\n", { mode: 0o600 });
  writeFileSync(
    credentials,
    [
      "AWS_ACCESS_KEY_ID=test-access-key",
      "AWS_SECRET_ACCESS_KEY=test-secret-access-key",
      `RESTIC_REPOSITORY=local:${join(directory, "repository")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(
    config,
    [
      "WORKSPACE_ID=operator",
      "DESTINATION_PROVIDER=cloudflare-r2",
      `BACKUP_SOURCE=${source}`,
      `BACKUP_STAGING_DIRECTORY=${staging}`,
      `BACKUP_EXCLUDES_FILE=${committedBackupExcludes}`,
      `BACKUP_STATUS_FILE=${status}`,
      `BACKUP_CREDENTIALS_FILE=${credentials}`,
      `BACKUP_PASSWORD_FILE=${password}`,
      "MAXIMUM_AGE_SECONDS=28800",
      "CHECK_READ_DATA_SUBSET=1%",
      "KEEP_WITHIN=14d",
      "KEEP_LAST=8",
      "",
    ].join("\n"),
  );
  writeFileSync(
    fakeStateExport,
    `#!/usr/bin/env bash
set -eu
source_directory=$1
target=$2
mkdir -p "$target/t3-databases" "$target/in-flight-worktrees"
cp "$source_directory/home/.t3/userdata/statev2.sqlite" "$target/t3-databases/statev2.sqlite"
cp "$source_directory/home/.t3/userdata/server-owner.sqlite" "$target/t3-databases/server-owner.sqlite"
printf '%s\\n' '{"schemaVersion":1,"exportedWorktrees":0}' >"$target/manifest.json"
`,
  );
  chmodSync(fakeStateExport, 0o700);
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
    test "$AWS_ACCESS_KEY_ID" = test-access-key
    test "$AWS_SECRET_ACCESS_KEY" = test-secret-access-key
    test -r "$RESTIC_PASSWORD_FILE"
    target=
    for argument in "$@"; do
      case "$argument" in
        --target=*) target=\${argument#--target=} ;;
      esac
    done
    test -n "$target"
    mkdir -p "$target$FAKE_RESTORE_SOURCE/home/.t3"
    mkdir -p "$target$FAKE_RESTORE_SOURCE/home/.t3/userdata"
    mkdir -p "$target$FAKE_BACKUP_STAGING_DIRECTORY/t3-databases"
    printf '%s\\n' state >"$target$FAKE_BACKUP_STAGING_DIRECTORY/t3-databases/statev2.sqlite"
    printf '%s\\n' owner >"$target$FAKE_BACKUP_STAGING_DIRECTORY/t3-databases/server-owner.sqlite"
    printf '%s\\n' '{"schemaVersion":1,"exportedWorktrees":0}' >"$target$FAKE_BACKUP_STAGING_DIRECTORY/manifest.json"
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
      FAKE_BACKUP_STAGING_DIRECTORY: staging,
      WORKSPACE_STATE_EXPORT_BIN: fakeStateExport,
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

function runGit(directory: string, args: readonly string[]) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function createStateExportFixture() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-state-export-"));
  const source = join(directory, "source");
  const userdata = join(source, "home/.t3/userdata");
  const workspaces = join(source, "workspaces");
  const target = join(directory, "export");
  const fakeSqlite = join(directory, "sqlite3");

  mkdirSync(userdata, { recursive: true });
  mkdirSync(workspaces, { recursive: true });
  writeFileSync(join(userdata, "statev2.sqlite"), "state\n");
  writeFileSync(join(userdata, "server-owner.sqlite"), "owner\n");
  writeFileSync(
    fakeSqlite,
    `#!/usr/bin/env bash
set -eu
database=$1
backup_command=$3
destination=\${backup_command#".backup '"}
destination=\${destination%"'"}
cp -- "$database" "$destination"
`,
  );
  chmodSync(fakeSqlite, 0o700);

  return { directory, fakeSqlite, source, target, workspaces };
}

test("state export keeps T3 databases and only in-flight Git changes", () => {
  const { directory, fakeSqlite, source, target, workspaces } =
    createStateExportFixture();
  const remote = join(directory, "remote.git");
  const repository = join(workspaces, "repository");
  const cleanRepository = join(workspaces, "clean-repository");
  const staleRepository = join(workspaces, "stale-repository");

  try {
    runGit(directory, ["init", "--bare", remote]);
    runGit(directory, ["clone", remote, repository]);
    runGit(repository, ["config", "user.name", "Backup Test"]);
    runGit(repository, ["config", "user.email", "backup@example.test"]);
    writeFileSync(join(repository, "tracked.txt"), "initial\n");
    runGit(repository, ["add", "tracked.txt"]);
    runGit(repository, ["commit", "-m", "initial"]);
    runGit(repository, ["push", "--set-upstream", "origin", "HEAD"]);
    runGit(directory, ["clone", remote, cleanRepository]);

    runGit(repository, ["switch", "-c", "stale-only"]);
    writeFileSync(join(repository, "stale.txt"), "remote branch to delete\n");
    runGit(repository, ["add", "stale.txt"]);
    runGit(repository, ["commit", "-m", "stale remote branch"]);
    runGit(repository, ["push", "--set-upstream", "origin", "HEAD"]);
    runGit(directory, ["clone", "--branch", "stale-only", remote, staleRepository]);
    runGit(repository, ["switch", "master"]);
    runGit(repository, ["push", "origin", "--delete", "stale-only"]);

    writeFileSync(join(repository, "committed.txt"), "local commit\n");
    runGit(repository, ["add", "committed.txt"]);
    runGit(repository, ["commit", "-m", "local only"]);
    writeFileSync(join(repository, "tracked.txt"), "initial\ndirty\n");
    writeFileSync(join(repository, "untracked.txt"), "untracked\n");

    const result = run(stateExportScript, [source, target], {
      ...process.env,
      SQLITE_BIN: fakeSqlite,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(target, "t3-databases/statev2.sqlite"), "utf8"),
      "state\n",
    );
    assert.equal(
      readFileSync(join(target, "t3-databases/server-owner.sqlite"), "utf8"),
      "owner\n",
    );

    const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
    assert.equal(manifest.exportedWorktrees, 2);
    assert.equal(manifest.skippedWorktrees, 0);
    const exported = readdirSync(join(target, "in-flight-worktrees"));
    assert.equal(exported.length, 2);
    const exportedStates = exported.map((entry) => {
      const stateDirectory = join(target, "in-flight-worktrees", entry);
      const metadata = JSON.parse(
        readFileSync(join(stateDirectory, "metadata.json"), "utf8"),
      );
      return { metadata, stateDirectory };
    });
    const repositoryState = exportedStates.find(
      ({ metadata }) => metadata.relativePath === "workspaces/repository",
    );
    assert.ok(repositoryState);
    const { metadata, stateDirectory } = repositoryState;
    assert.equal(metadata.relativePath, "workspaces/repository");
    assert.equal(metadata.unpushedCommitCount, 1);
    assert.equal(metadata.remoteRefsCurrent, true);
    assert.match(readFileSync(join(stateDirectory, "tracked.patch"), "utf8"), /\+dirty/);

    const tarListing = spawnSync(
      "tar",
      ["-tzf", join(stateDirectory, "untracked.tar.gz")],
      { encoding: "utf8" },
    );
    assert.equal(tarListing.status, 0, tarListing.stderr);
    assert.match(tarListing.stdout, /^untracked\.txt$/m);
    const bundleVerification = spawnSync(
      "git",
      ["bundle", "verify", join(stateDirectory, "unpushed.bundle")],
      { cwd: repository, encoding: "utf8" },
    );
    assert.equal(bundleVerification.status, 0, bundleVerification.stderr);

    const staleState = exportedStates.find(
      ({ metadata: staleMetadata }) =>
        staleMetadata.relativePath === "workspaces/stale-repository",
    );
    assert.ok(staleState);
    assert.equal(staleState.metadata.unpushedCommitCount, 1);
    assert.equal(staleState.metadata.remoteRefsCurrent, true);
    const staleBundleVerification = spawnSync(
      "git",
      ["bundle", "verify", join(staleState.stateDirectory, "unpushed.bundle")],
      { cwd: staleRepository, encoding: "utf8" },
    );
    assert.equal(staleBundleVerification.status, 0, staleBundleVerification.stderr);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("state export fails after recording an unreadable worktree candidate", () => {
  const { directory, fakeSqlite, source, target, workspaces } =
    createStateExportFixture();
  mkdirSync(join(workspaces, "broken/.git"), { recursive: true });

  try {
    const result = run(stateExportScript, [source, target], {
      ...process.env,
      SQLITE_BIN: fakeSqlite,
    });
    assert.notEqual(result.status, 0);
    const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
    assert.equal(manifest.exportedWorktrees, 0);
    assert.equal(manifest.skippedWorktrees, 1);
    assert.match(result.stderr, /skipped 1 worktree/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("state export fails when worktree discovery is incomplete", () => {
  const { directory, fakeSqlite, source, target } = createStateExportFixture();
  const fakeFind = join(directory, "find");
  writeFileSync(
    fakeFind,
    `#!/usr/bin/env bash
printf '%s\\0' "$1/partial/.git"
exit 7
`,
  );
  chmodSync(fakeFind, 0o700);

  try {
    const result = run(stateExportScript, [source, target], {
      ...process.env,
      FIND_BIN: fakeFind,
      SQLITE_BIN: fakeSqlite,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree discovery failed/);
    assert.equal(spawnSync("test", ["-e", join(target, "manifest.json")]).status, 1);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("state export preserves full history when remote refresh fails", () => {
  const { directory, fakeSqlite, source, target, workspaces } =
    createStateExportFixture();
  const repository = join(workspaces, "offline-remote");

  try {
    runGit(directory, ["init", repository]);
    runGit(repository, ["config", "user.name", "Backup Test"]);
    runGit(repository, ["config", "user.email", "backup@example.test"]);
    writeFileSync(join(repository, "tracked.txt"), "local history\n");
    runGit(repository, ["add", "tracked.txt"]);
    runGit(repository, ["commit", "-m", "local history"]);
    runGit(repository, ["remote", "add", "origin", join(directory, "missing.git")]);

    const result = run(stateExportScript, [source, target], {
      ...process.env,
      SQLITE_BIN: fakeSqlite,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /exporting complete reachable history/);

    const [stateEntry] = readdirSync(join(target, "in-flight-worktrees"));
    assert.ok(stateEntry);
    const stateDirectory = join(target, "in-flight-worktrees", stateEntry);
    const metadata = JSON.parse(
      readFileSync(join(stateDirectory, "metadata.json"), "utf8"),
    );
    assert.equal(metadata.remoteRefsCurrent, false);
    assert.equal(metadata.unpushedCommitCount, 1);
    const bundleVerification = spawnSync(
      "git",
      ["bundle", "verify", join(stateDirectory, "unpushed.bundle")],
      { cwd: repository, encoding: "utf8" },
    );
    assert.equal(bundleVerification.status, 0, bundleVerification.stderr);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("backup includes only T3 state exports and prunes snapshots after 14 days", () => {
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
    assert.match(
      calls,
      new RegExp(
        `backup .* ${join(fixture.source, "home/.t3/userdata").replaceAll("/", "\\/")} .*backup-state\\/staging$`,
        "m",
      ),
    );
    assert.match(calls, /--exclude-file=.*backup-excludes\.txt/);
    assert.match(calls, /check --read-data-subset=1%/);
    assert.match(
      calls,
      /forget .*--keep-within=14d --keep-last=8 --prune/,
    );
    assert.equal(spawnSync("test", ["-e", expiredSnapshot]).status, 1);
    assert.doesNotMatch(
      readFileSync(committedBackupExcludes, "utf8"),
      /t3-code\/workspaces$/m,
    );
    assert.match(
      readFileSync(committedBackupExcludes, "utf8"),
      /\*\*\/userdata\/secrets/,
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
    const restoreEnvironment = { ...fixture.environment };
    delete restoreEnvironment.RESTIC_REPOSITORY;
    const first = run(restoreScript, [target], restoreEnvironment);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(
      first.stdout.includes("T3 state and in-flight worktree exports are present"),
      true,
    );
    assert.equal(
      readFileSync(fixture.calls, "utf8").includes("restore latest"),
      true,
    );

    const second = run(restoreScript, [target], restoreEnvironment);
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
