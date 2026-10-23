import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const installScript = join(projectDirectory, "scripts/install.sh");
const backupScript = join(projectDirectory, "scripts/backup.sh");
const restoreScript = join(projectDirectory, "scripts/restore.sh");
const maintenanceScript = join(
  projectDirectory,
  "scripts/maintenance.sh",
);

interface Fixture {
  directory: string;
  config: string;
  status: string;
  calls: string;
  environment: NodeJS.ProcessEnv;
}

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "personal-archive-"));
  const source = join(directory, "Documents");
  const config = join(directory, "config");
  const status = join(directory, "status.json");
  const password = join(directory, "restic-password");
  const credentials = join(directory, "restic.env");
  const recoveryCredentials = join(directory, "recovery.env");
  const maintenanceCredentials = join(directory, "maintenance.env");
  const sources = join(directory, "sources.txt");
  const excludes = join(directory, "excludes.txt");
  const calls = join(directory, "restic-calls");
  const marker = join(directory, "repository-initialized");
  const fakeRestic = join(directory, "restic");

  mkdirSync(join(source, "records"), { recursive: true });
  writeFileSync(join(source, "records/letter.pdf"), "document\n");
  writeFileSync(sources, `${source}\n`);
  writeFileSync(excludes, "*.jpg\n*.ts\n");
  writeFileSync(password, "test-password\n", { mode: 0o600 });
  const repositoryEnvironment = [
    "AWS_ACCESS_KEY_ID=test-key",
    "AWS_SECRET_ACCESS_KEY=test-secret",
    `RESTIC_REPOSITORY=local:${join(directory, "repository")}`,
    "",
  ].join("\n");
  writeFileSync(
    credentials,
    repositoryEnvironment,
    { mode: 0o600 },
  );
  writeFileSync(recoveryCredentials, repositoryEnvironment, { mode: 0o600 });
  writeFileSync(maintenanceCredentials, repositoryEnvironment, { mode: 0o600 });
  writeFileSync(
    config,
    [
      "ARCHIVE_ID=robbie-vector-gp68hx-13vh-documents",
      "DESTINATION_PROVIDER=local",
      "OPERATION_MODE=one-shot",
      "B2_BUCKET_NAME_EXPECTED=robbie-personal-archive",
      "REPOSITORY_PREFIX=restic/robbie-vector-gp68hx-13vh-documents",
      `BACKUP_SOURCES_FILE=${sources}`,
      `BACKUP_EXCLUDES_FILE=${excludes}`,
      `BACKUP_STATUS_FILE=${status}`,
      `BACKUP_CREDENTIALS_FILE=${credentials}`,
      `BACKUP_PASSWORD_FILE=${password}`,
      `BACKUP_LOCK_FILE=${join(directory, "backup.lock")}`,
      "MAXIMUM_AGE_SECONDS=129600",
      "CHECK_READ_DATA_SUBSET=5%",
      "KEEP_WITHIN_DAILY=30d",
      "KEEP_WITHIN_MONTHLY=1y",
      "KEEP_WITHIN_YEARLY=10y",
      "",
    ].join("\n"),
  );
  writeFileSync(
    fakeRestic,
    `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>"$FAKE_RESTIC_CALLS"
case " $* " in
  *" snapshots "*) test -f "$FAKE_REPOSITORY_MARKER" ;;
  *" init "*) touch "$FAKE_REPOSITORY_MARKER" ;;
  *" backup "*) test "\${FAKE_BACKUP_FAILURE:-0}" = 0 || exit 42 ;;
  *" check "*) test "\${FAKE_CHECK_FAILURE:-0}" = 0 || exit 43 ;;
  *" stats "*) printf '{"total_size":1234}\n' ;;
  *" restore "*)
    target=
    for argument in "$@"; do
      case "$argument" in --target=*) target=\${argument#--target=} ;; esac
    done
    test -n "$target"
    mkdir -p "$target/restored"
    printf 'document\n' >"$target/restored/letter.pdf"
    ;;
  *" forget "*) : ;;
  *" unlock "*) : ;;
  *) exit 90 ;;
esac
`,
  );
  chmodSync(fakeRestic, 0o700);

  return {
    directory,
    config,
    status,
    calls,
    environment: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      PERSONAL_ARCHIVE_CONFIG: config,
      RESTIC_BIN: fakeRestic,
      PERSONAL_ARCHIVE_RECOVERY_CREDENTIALS: recoveryCredentials,
      PERSONAL_ARCHIVE_RECOVERY_PASSWORD: password,
      PERSONAL_ARCHIVE_MAINTENANCE_CREDENTIALS: maintenanceCredentials,
      FAKE_RESTIC_CALLS: calls,
      FAKE_REPOSITORY_MARKER: marker,
    },
  };
}

function run(
  script: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync("bash", [script, ...args], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });
}

test("backup never runs destructive retention commands", () => {
  const fixture = createFixture();
  try {
    const result = run(backupScript, [], fixture.environment);
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, /--no-lock backup/);
    assert.match(calls, /--no-lock check --read-data-subset=5%/);
    assert.doesNotMatch(calls, /forget|prune|unlock/);
    const status = JSON.parse(readFileSync(fixture.status, "utf8"));
    assert.equal(status.state, "success");
    assert.equal(status.repositoryBytes, 1234);
    assert.equal(JSON.stringify(status).includes(fixture.directory), false);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("backup failures produce safe status", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.directory, "repository-initialized"), "ready\n");
  try {
    const result = run(backupScript, [], {
      ...fixture.environment,
      FAKE_BACKUP_FAILURE: "1",
    });
    assert.equal(result.status, 42);
    const status = JSON.parse(readFileSync(fixture.status, "utf8"));
    assert.equal(status.state, "failed");
    assert.equal(status.failedStep, "backup");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("Backblaze credentials must match the installed inventory", () => {
  const fixture = createFixture();
  const config = readFileSync(fixture.config, "utf8").replace(
    "DESTINATION_PROVIDER=local",
    "DESTINATION_PROVIDER=backblaze-b2",
  );
  writeFileSync(fixture.config, config);
  try {
    const result = run(backupScript, [], fixture.environment);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      "RESTIC_REPOSITORY does not match the installed inventory",
    );
    assert.equal(result.stdout, "");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("independent recovery verifies repository checksums into an empty target", () => {
  const fixture = createFixture();
  const target = join(fixture.directory, "restore");
  try {
    const first = run(restoreScript, [target], fixture.environment);
    assert.equal(first.status, 0, first.stderr);
    assert.match(readFileSync(fixture.calls, "utf8"), /--no-lock restore latest .*--verify/);
    const second = run(restoreScript, [target], fixture.environment);
    assert.equal(second.status, 1);
    assert.equal(second.stderr.trim(), "restore target must be empty");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("maintenance is dry-run by default and delete-capable only when applied", () => {
  const fixture = createFixture();
  try {
    const dryRun = run(maintenanceScript, [], fixture.environment);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    let calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, /forget .*--keep-within-daily=30d .*--dry-run/);
    assert.doesNotMatch(calls, /unlock/);

    writeFileSync(fixture.calls, "");
    const applied = run(maintenanceScript, ["--apply"], fixture.environment);
    assert.equal(applied.status, 0, applied.stderr);
    calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, /forget .*--prune/);
    assert.doesNotMatch(calls, /--dry-run|unlock/);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("repeated installation does not replace the managed restic link with a self-link", () => {
  const directory = mkdtempSync(join(tmpdir(), "personal-archive-install-"));
  const home = join(directory, "home");
  const fakeBin = join(directory, "bin");
  const fakeRestic = join(fakeBin, "restic");
  const fakeSystemctl = join(fakeBin, "systemctl");
  const inventory = join(
    projectDirectory,
    "inventories/robbie-vector-gp68hx-13vh.json",
  );

  mkdirSync(join(home, ".local/bin"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(fakeRestic, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
  writeFileSync(fakeSystemctl, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });

  const environment = {
    ...process.env,
    HOME: home,
    PATH: `${join(home, ".local/bin")}:${fakeBin}:${process.env.PATH}`,
  };

  try {
    const first = run(installScript, [inventory], environment);
    assert.equal(first.status, 0, first.stderr);
    const managedRestic = join(home, ".local/bin/restic");
    assert.equal(readlinkSync(managedRestic), fakeRestic);

    const second = run(installScript, [inventory], environment);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readlinkSync(managedRestic), fakeRestic);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
