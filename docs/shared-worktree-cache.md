# Shared worktree cache

The remote workspace keeps worktrees isolated while sharing immutable inputs and
verified task results. It does not share `node_modules`, `.next`, `out`, test
temporary files, or any other mutable worktree directory.

## Measured baseline

The first measurements were taken on 15 October 2026 from revision
`5ed1715a04c58331fd3b1110dc78f8bb57ca60fd` on an Apple silicon Mac mini. The
process used Node 24.21.0 and pnpm 12.8.1. This is a local proxy for the remote
workspace. Run the same commands in the Linux operator pod after deployment to
record cgroup-level I/O and concurrent memory pressure.

| Operation | Wall time | User CPU | System CPU | Peak resident memory | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Install into a new worktree from the shared pnpm store | 31.7 s | not recorded | not recorded | not recorded | 1,612 packages reused, 0 downloaded |
| Fresh UI build without the task cache | 362.85 s | 525.84 s | 72.32 s | 2,119,860,224 bytes | passed |
| UI test suite without the task cache | 427.50 s | 1,251.98 s | 203.85 s | 678,363,136 bytes | 2,132 passed, 5 timed out |
| UI build that populated the task cache | 221.34 s | 341.35 s | 48.90 s | 2,533,507,072 bytes | passed, with a warm local `.next` directory |
| Verified UI build cache hit | 10.94 s | 5.19 s | 4.77 s | 132,792,320 bytes | restored `ui/out` |

The verified build hit cut wall time by 97.0% and CPU time by 98.3% against the
fresh uncached build. It restored 328,517,297 file bytes. The cached entry used
327,708 KiB on disk.

The failed test run is intentional evidence for the failure boundary. The
wrapper did not publish it. A later agent must still run the suite until the
same revision passes once before another worktree can reuse that result.

The worktree-local byte cost was 2,411,768 KiB for `node_modules`, 1,833,032
KiB for `.next`, and 327,700 KiB for `out`. Two uncached agents at the same
revision can therefore create about 8.7 GiB of worktree-local files between
them, before temporary files. pnpm uses clones or hard links from its shared
content-addressed store, so the `node_modules` number is logical size rather
than an equal increase in allocated blocks. The task cache avoids the second
build or test execution, but it copies verified output into each worktree. It
does not hard-link mutable output to the cache.

The cache unit test runs two clients against one empty key at the same time. It
records one command execution, one miss, one waiter, and one verified hit. Run
`mise //:shared-cache:test` to repeat the check.

## Cache boundaries

| Data | Shared location | Invalidation | Writer rule |
| --- | --- | --- | --- |
| pnpm package blobs | `/data/home/.local/share/pnpm` | pnpm integrity and package identity | pnpm content-addressed store |
| mise tools | `/data/home/.local/share/mise` and `/data/home/.cache` | tool backend, version, platform, checksum | mise-managed installs |
| Browser downloads | `/data/home/.cache` | tool version and platform | Playwright and Puppeteer installers |
| Arduino downloads | `/data/home/.arduino15` | Arduino package metadata and checksum | Arduino CLI |
| Successful UI build output | `/data/cache/shared-task-cache` | cache schema, full Git revision, dirty-tree digest, command, platform, architecture, Node version, pnpm version, lockfile, selected environment | one atomic publisher per key |
| Successful UI test result | `/data/cache/shared-task-cache` | same key fields as the build | one atomic publisher per key |

`node_modules` stays inside each worktree. Sharing it would allow one install to
change another agent's executable links and lifecycle output. `.next` also
stays local because Next mutates it throughout a build. The cache stores the
finished static export and a successful test marker instead.

The build key hashes `CF_PAGES_URL`, `NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`,
`NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_KEY`,
`NEXT_PUBLIC_PREVIEW_BACKEND`, and `NODE_ENV`. These are the variables read by
the production UI build. The manifest stores only their hashes. It never
persists the values themselves.

## Concurrency and recovery

Each key has an atomic directory lock. The first agent runs the command and
publishes a temporary entry with a final rename. Other agents wait, then verify
and restore that entry. Entries never change after publication except for their
last-access timestamp.

Before a hit, the reader checks the manifest, revision, dirty-tree digest,
environment hashes, declared outputs, byte count, file modes, symlink targets,
and SHA-256 tree digest. A mismatch removes only that entry and runs the task.
Tests cover concurrent writers, a dirty source tree, a changed environment,
modified artifact bytes, and quota pruning.

A failed command publishes nothing. An interrupted publisher leaves its work
under the cache's `tmp` directory. Pruning removes stale temporary directories.
An abandoned key lock becomes recoverable after two hours, but a live process
on the same host keeps ownership.

## Capacity and operations

The host gives all rebuildable caches a separate 30 GiB project quota. The task
cache gets at most 12 GiB and keeps entries for up to 14 days. This leaves 18
GiB for package, tool, browser, and Arduino caches. Every task invocation runs
pruning. Operators can also inspect or prune it directly:

```bash
mise //:shared-cache:status
mise //:shared-cache:prune
```

Netdata receives cumulative hit, miss, run, wait, failure, corruption, restored
byte, published byte, and reclaimed byte counters. The existing quota charts
and alerts cover the whole 30 GiB cache project.

If the task cache is lost or corrupt, delete its dedicated
`shared-task-cache` directory and recreate it with owner and group `t3code` and
mode `0750`. No durable workspace data or login state lives there. The next
successful build repopulates it.

## Remote benchmark

Run these commands in two clean operator worktrees at one revision. Use the
host's cgroup and pressure metrics for the aggregate CPU, memory, and I/O result.

```bash
NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH=placeholder \
  /usr/bin/time -v mise //ui:build

/usr/bin/time -v mise //ui:test

mise //:shared-cache:status
```

For the uncached baseline, unset `SHARED_TASK_CACHE_DIR`. For the cold cached
run, point both worktrees at the same empty temporary cache directory and start
the commands together. For the hit measurement, remove only the generated
`ui/out` directory from the second worktree and repeat its build. Do not remove
or edit the production cache to benchmark it.

## Separate worker pods

The current persistent volume is `ReadWriteOnce` and all agents run in one pod
on one node. Separate pods on the same node need a volume that supports the
chosen concurrent mount pattern. Pods on different nodes need a shared object
store or remote cache service.

Before that move, replace directory locks with a lease that has an owner token
and heartbeat, upload immutable entries under their full key, and publish a
small signed manifest last. Keep worktree-local restores as copies. Measure
cross-node transfer cost before caching `.next` or native compiler output,
because those artifacts have broader platform and toolchain inputs than the
static export.
