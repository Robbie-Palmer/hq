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

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const experimentScript = join(
  projectDirectory,
  "scripts/object-lock-experiment.sh",
);

interface Fixture {
  directory: string;
  calls: string;
  keys: string;
  environment: NodeJS.ProcessEnv;
  idleProof: string;
  bucketState: string;
}

function createFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "object-lock-experiment-"));
  const binDirectory = join(directory, "bin");
  const runtimeDirectory = join(directory, "runtime");
  const calls = join(directory, "calls.log");
  const keys = join(directory, "keys.log");
  const bucketState = join(directory, "bucket-state");
  const prefixState = join(directory, "prefix-state");
  const idleProof = join(directory, "idle-proof.json");
  const adminKeyId = join(directory, "admin-key-id");
  const adminKey = join(directory, "admin-key");
  const fakeB2 = join(binDirectory, "b2");
  const fakeRestic = join(binDirectory, "restic");

  mkdirSync(binDirectory);
  mkdirSync(runtimeDirectory);
  writeFileSync(calls, "");
  writeFileSync(keys, "");
  writeFileSync(bucketState, "none\n");
  writeFileSync(prefixState, "present\n");
  writeFileSync(adminKeyId, "admin-id\n", { mode: 0o600 });
  writeFileSync(adminKey, "admin-secret\n", { mode: 0o600 });
  writeFileSync(
    idleProof,
    JSON.stringify({
      schemaVersion: 1,
      archiveId: "robbie-vector-gp68hx-13vh-home-migration",
      checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      host: "archive-source",
      idle: true,
      serviceState: "inactive",
      timerState: "inactive",
      timerEnabled: "disabled",
    }),
  );
  writeFileSync(
    fakeB2,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >>"$FAKE_CALLS"
printf '\n' >>"$FAKE_CALLS"
case "$1 $2" in
  "bucket get")
    mode=$(<"$FAKE_BUCKET_STATE")
    if [[ "$mode" = none ]]; then
      retention='{"mode":null,"period":null}'
    else
      retention='{"mode":"governance","period":{"duration":1,"unit":"days"}}'
    fi
    printf '{"bucketName":"robbie-personal-archive","bucketType":"allPrivate","fileLockConfiguration":{"isClientAuthorizedToRead":true,"value":{"isFileLockEnabled":true,"defaultRetention":%s}}}\n' "$retention"
    ;;
  "bucket update")
    if [[ " $* " = *" --default-retention-mode governance "* ]]; then
      printf 'governance\n' >"$FAKE_BUCKET_STATE"
    elif [[ " $* " = *" --default-retention-mode none "* ]]; then
      printf 'none\n' >"$FAKE_BUCKET_STATE"
    else
      exit 90
    fi
    printf 'bucket-id\n'
    ;;
  "key create")
    name=\${@: -2:1}
    capabilities=\${@: -1}
    prefix=-
    bucket=-
    previous=
    for argument in "$@"; do
      if [[ "$previous" = --name-prefix ]]; then prefix="'$argument'"; fi
      if [[ "$previous" = --bucket ]]; then bucket=$argument; fi
      previous=$argument
    done
    if [[ "\${FAKE_ADD_BYPASS:-0}" = 1 && "$name" = *-policy ]]; then
      capabilities="$capabilities,bypassGovernance"
    fi
    if [[ "\${FAKE_MAINTENANCE_BYPASS:-0}" = 1 && "$name" = *-maintenance ]]; then
      capabilities="$capabilities,bypassGovernance"
    fi
    printf 'id-%s %s %s - - %s %s\n' "$name" "$name" "$bucket" "$prefix" "$capabilities" >>"$FAKE_KEYS"
    printf 'id-%s secret-%s\n' "$name" "$name"
    ;;
  "key list") cat "$FAKE_KEYS" ;;
  "key delete")
    key_id=$3
    awk -v key_id="$key_id" '$1 != key_id' "$FAKE_KEYS" >"$FAKE_KEYS.next"
    mv "$FAKE_KEYS.next" "$FAKE_KEYS"
    ;;
  "ls --recursive")
    if [[ "$(<"$FAKE_PREFIX_STATE")" = empty ]]; then
      printf '[]\n'
    else
      if [[ "\${FAKE_EXPIRED:-0}" = 1 ]]; then
        retain_until=$(( $(date +%s) * 1000 - 1000 ))
      else
        retain_until=$(( $(date +%s) * 1000 + 86400000 ))
      fi
      upload_time=$(( retain_until - 86400000 ))
      printf '[{"fileName":"disposable/config","fileId":"file-id","size":321,"uploadTimestamp":%s,"fileRetention":{"isClientAuthorizedToRead":true,"value":{"mode":"governance","retainUntilTimestamp":%s}}}]\n' "$upload_time" "$retain_until"
    fi
    ;;
  "rm --fail-fast")
    echo 'file is protected by retention' >&2
    exit 1
    ;;
  "rm --recursive") printf 'empty\n' >"$FAKE_PREFIX_STATE" ;;
  *) echo "unexpected b2 call: $*" >&2; exit 91 ;;
esac
`,
    { mode: 0o700 },
  );
  writeFileSync(
    fakeRestic,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'restic %q ' "$@" >>"$FAKE_CALLS"
printf '\n' >>"$FAKE_CALLS"
case "$1" in
  init) : ;;
  backup) [[ "\${FAKE_BACKUP_FAILURE:-0}" = 0 ]] || exit 42 ;;
  forget) echo 'object is protected by retention' >&2; exit 1 ;;
  *) exit 92 ;;
esac
`,
    { mode: 0o700 },
  );
  chmodSync(fakeB2, 0o700);
  chmodSync(fakeRestic, 0o700);

  return {
    directory,
    calls,
    keys,
    idleProof,
    bucketState,
    environment: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      B2_BIN: fakeB2,
      RESTIC_BIN: fakeRestic,
      B2_ADMIN_KEY_ID_FILE: adminKeyId,
      B2_ADMIN_APPLICATION_KEY_FILE: adminKey,
      XDG_RUNTIME_DIR: runtimeDirectory,
      FAKE_CALLS: calls,
      FAKE_KEYS: keys,
      FAKE_BUCKET_STATE: bucketState,
      FAKE_PREFIX_STATE: prefixState,
    },
  };
}

function run(
  fixture: Fixture,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return spawnSync("bash", [experimentScript, ...args], {
    cwd: projectDirectory,
    encoding: "utf8",
    env: { ...fixture.environment, ...extraEnvironment },
    timeout: 30_000,
  });
}

test("rejects production and malformed prefixes before calling B2", () => {
  const fixture = createFixture();
  try {
    const result = run(fixture, [
      "cleanup",
      "--prefix",
      "restic/robbie-vector-gp68hx-13vh-home-migration",
      "--retain-until",
      "2000-01-01T00:00:00Z",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disposable repository prefix is invalid/);
    assert.equal(readFileSync(fixture.calls, "utf8"), "");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("uses an isolated prefix, removes the default, and revokes bounded keys", () => {
  const fixture = createFixture();
  try {
    const result = run(fixture, ["start", "--idle-proof", fixture.idleProof]);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.match(
      evidence.prefix,
      /^object-lock-experiments\/\d{8}T\d{6}Z-[a-f0-9]{12}\/restic$/,
    );
    assert.equal(evidence.defaultPolicyTeardown, true);
    assert.equal(evidence.directDeleteRejected, true);
    assert.equal(evidence.resticPruneRejected, true);
    assert.equal(evidence.maintenanceKeyRevoked, true);
    assert.equal(readFileSync(fixture.bucketState, "utf8").trim(), "none");

    const calls = readFileSync(fixture.calls, "utf8");
    const enableIndex = calls.indexOf("--default-retention-mode governance");
    const disableIndex = calls.indexOf("--default-retention-mode none");
    const deleteIndex = calls.indexOf("rm --fail-fast");
    assert.ok(enableIndex >= 0);
    assert.ok(disableIndex > enableIndex);
    assert.ok(deleteIndex > disableIndex);
    assert.ok(calls.indexOf("bucket get") < calls.indexOf("-maintenance"));
    assert.match(
      calls,
      /key create --duration 7200 object-lock-[^ ]+-maintenance listKeys\\,writeKeys\\,deleteKeys\\,listBuckets\\,writeBuckets\\,readBucketRetentions\\,writeBucketRetentions\\,readBucketEncryption/,
    );
    assert.match(calls, /--default-retention-period 1\\ day/);
    assert.match(calls, /--name-prefix object-lock-experiments\//);
    assert.doesNotMatch(calls, /bypassGovernance/);
    assert.match(calls, /key delete/);
    assert.equal(readFileSync(fixture.keys, "utf8"), "");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("refuses to overwrite an existing bucket default", () => {
  const fixture = createFixture();
  writeFileSync(fixture.bucketState, "governance\n");
  try {
    const result = run(fixture, ["start", "--idle-proof", fixture.idleProof]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already has default retention/);
    const calls = readFileSync(fixture.calls, "utf8");
    assert.doesNotMatch(calls, /key create|bucket update/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("tears down the bucket default and revokes keys after upload failure", () => {
  const fixture = createFixture();
  try {
    const result = run(
      fixture,
      ["start", "--idle-proof", fixture.idleProof],
      { FAKE_BACKUP_FAILURE: "1" },
    );
    assert.equal(result.status, 42, result.stderr);
    assert.equal(readFileSync(fixture.bucketState, "utf8").trim(), "none");
    const calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, /--default-retention-mode governance/);
    assert.match(calls, /--default-retention-mode none/);
    assert.match(calls, /key delete/);
    assert.equal(readFileSync(fixture.keys, "utf8"), "");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a temporary key that gains governance bypass", () => {
  const fixture = createFixture();
  try {
    const result = run(
      fixture,
      ["start", "--idle-proof", fixture.idleProof],
      { FAKE_ADD_BYPASS: "1" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bypassGovernance authority/);
    const calls = readFileSync(fixture.calls, "utf8");
    assert.doesNotMatch(calls, /bucket update/);
    assert.match(calls, /key delete/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("revokes a maintenance key that gains governance bypass", () => {
  const fixture = createFixture();
  try {
    const result = run(
      fixture,
      ["start", "--idle-proof", fixture.idleProof],
      { FAKE_MAINTENANCE_BYPASS: "1" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bypassGovernance authority/);
    const calls = readFileSync(fixture.calls, "utf8");
    assert.doesNotMatch(calls, /-policy|bucket update/);
    assert.match(calls, /key delete id-object-lock-[^ ]+-maintenance/);
    assert.equal(readFileSync(fixture.keys, "utf8"), "");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("removes only an expired disposable prefix and revokes its cleanup key", () => {
  const fixture = createFixture();
  const prefix =
    "object-lock-experiments/20261101T120000Z-0123456789ab/restic";
  try {
    const result = run(
      fixture,
      [
        "cleanup",
        "--prefix",
        prefix,
        "--retain-until",
        "2000-01-01T00:00:00Z",
      ],
      { FAKE_EXPIRED: "1" },
    );
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.deepEqual(evidence, {
      schemaVersion: 1,
      prefix,
      repositoryRemoved: true,
      cleanupKeyRevoked: true,
      maintenanceKeyRevoked: true,
      defaultPolicyStillAbsent: true,
    });
    const calls = readFileSync(fixture.calls, "utf8");
    assert.match(calls, new RegExp(`--name-prefix ${prefix}/`));
    assert.match(
      calls,
      new RegExp(`b2://robbie-personal-archive/${prefix}/`),
    );
    assert.match(calls, /rm --recursive --versions --fail-fast --no-progress/);
    assert.doesNotMatch(calls, /bypassGovernance/);
    assert.match(calls, /key delete/);
    assert.equal(readFileSync(fixture.keys, "utf8"), "");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
