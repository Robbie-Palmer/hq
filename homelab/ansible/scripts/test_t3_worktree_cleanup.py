import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "roles"
    / "t3_worktree_cleanup"
    / "files"
    / "t3-worktree-cleanup"
)


class T3WorktreeCleanupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary_directory.name)
        self.repository = self.base / "repository"
        self.worktree_root = self.base / "home" / ".t3" / "worktrees"
        self.state_directory = self.base / "state"
        self.database = self.base / "state.sqlite"
        self.worktree_root.mkdir(parents=True)

        self.git("init", "--initial-branch=main", str(self.repository), cwd=self.base)
        self.git("config", "user.name", "T3 Cleanup Test")
        self.git("config", "user.email", "cleanup@example.invalid")
        (self.repository / "tracked.txt").write_text("original\n")
        self.git("add", "tracked.txt")
        self.git("commit", "-m", "initial")

        with sqlite3.connect(self.database) as connection:
            connection.executescript(
                """
                CREATE TABLE projection_threads (
                    thread_id TEXT PRIMARY KEY,
                    worktree_path TEXT,
                    deleted_at TEXT,
                    archived_at TEXT,
                    settled_at TEXT,
                    updated_at TEXT NOT NULL,
                    pinned_at TEXT,
                    pending_approval_count INTEGER NOT NULL DEFAULT 0,
                    pending_user_input_count INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE projection_thread_sessions (
                    thread_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    active_turn_id TEXT
                );
                CREATE TABLE provider_session_runtime (
                    thread_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL
                );
                """
            )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def git(self, *arguments: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/usr/bin/git", *arguments],
            cwd=cwd or self.repository,
            check=True,
            text=True,
            capture_output=True,
        )

    def add_worktree(
        self,
        thread_id: str,
        *,
        lifecycle: str = "settled",
        lifecycle_at: str = "2020-01-01T00:00:00Z",
        session_status: str = "stopped",
        runtime_status: str = "stopped",
        pinned: bool = False,
        dirty: bool = False,
    ) -> Path:
        path = self.worktree_root / "project" / f"t3code-{thread_id}"
        path.parent.mkdir(parents=True, exist_ok=True)
        self.git("worktree", "add", "-b", f"t3code/{thread_id}", str(path))

        lifecycle_values = {"deleted": None, "archived": None, "settled": None}
        lifecycle_values[lifecycle] = lifecycle_at
        with sqlite3.connect(self.database) as connection:
            connection.execute(
                """
                INSERT INTO projection_threads (
                    thread_id,
                    worktree_path,
                    deleted_at,
                    archived_at,
                    settled_at,
                    updated_at,
                    pinned_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    thread_id,
                    str(path),
                    lifecycle_values["deleted"],
                    lifecycle_values["archived"],
                    lifecycle_values["settled"],
                    lifecycle_at,
                    lifecycle_at if pinned else None,
                ),
            )
            connection.execute(
                "INSERT INTO projection_thread_sessions VALUES (?, ?, NULL)",
                (thread_id, session_status),
            )
            connection.execute(
                "INSERT INTO provider_session_runtime VALUES (?, ?)",
                (thread_id, runtime_status),
            )

        if dirty:
            (path / "tracked.txt").write_text("changed\n")
            (path / "untracked.txt").write_text("recover me\n")
        return path

    def run_cleanup(
        self,
        mode: str,
        *,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "/bin/bash",
                str(SCRIPT),
                mode,
                "--database",
                str(self.database),
                "--worktree-root",
                str(self.worktree_root),
                "--state-dir",
                str(self.state_directory),
                "--deleted-days",
                "2",
                "--archived-days",
                "7",
                "--settled-days",
                "7",
            ],
            check=check,
            text=True,
            capture_output=True,
        )

    def test_dry_run_reports_without_changing_dirty_worktree(self) -> None:
        path = self.add_worktree("dry-run", dirty=True)

        result = self.run_cleanup("--dry-run")

        self.assertTrue(path.exists())
        self.assertIn("DRY-RUN remove settled worktree", result.stdout)
        self.assertIn("dirty=true", result.stdout)
        refs = self.git("for-each-ref", "--format=%(refname)", "refs/t3-worktree-archive").stdout
        self.assertEqual("", refs)

    def test_apply_archives_dirty_changes_and_removes_worktree(self) -> None:
        path = self.add_worktree("dirty", dirty=True)

        result = self.run_cleanup("--apply")

        self.assertFalse(path.exists())
        self.assertIn("ARCHIVE dirty dirty changes saved", result.stdout)
        self.assertIn("REMOVE dirty lifecycle=settled", result.stdout)
        refs = self.git(
            "for-each-ref",
            "--format=%(refname)",
            "refs/t3-worktree-archive/dirty",
        ).stdout.splitlines()
        self.assertEqual(1, len(refs))

        restored = self.base / "restored"
        self.git("worktree", "add", str(restored), "t3code/dirty")
        self.git("stash", "apply", refs[0], cwd=restored)
        self.assertEqual("changed\n", (restored / "tracked.txt").read_text())
        self.assertEqual("recover me\n", (restored / "untracked.txt").read_text())

    def test_apply_skips_recent_pinned_and_running_threads(self) -> None:
        recent = self.add_worktree(
            "recent",
            lifecycle_at="2999-01-01T00:00:00Z",
        )
        pinned = self.add_worktree("pinned", pinned=True)
        running = self.add_worktree("running", session_status="running")

        result = self.run_cleanup("--apply")

        self.assertTrue(recent.exists())
        self.assertTrue(pinned.exists())
        self.assertTrue(running.exists())
        self.assertIn("candidates=0", result.stdout)

    def test_stale_lock_is_recovered(self) -> None:
        path = self.add_worktree("stale-lock")
        lock = self.state_directory / "lock"
        lock.mkdir(parents=True)
        (lock / "pid").write_text("999999\n")

        result = self.run_cleanup("--dry-run")

        self.assertTrue(path.exists())
        self.assertIn("DRY-RUN remove settled worktree", result.stdout)
        self.assertFalse(lock.exists())

    def test_apply_continues_after_worktree_removal_failure(self) -> None:
        blocked = self.add_worktree("blocked")
        later = self.add_worktree("later")
        self.git("worktree", "lock", str(blocked), "--reason", "test fixture")

        result = self.run_cleanup("--apply", check=False)

        self.assertEqual(1, result.returncode)
        self.assertTrue(blocked.exists())
        self.assertFalse(later.exists())
        self.assertIn("Git refused to remove blocked", result.stderr)
        self.assertIn("removed=1 failed=1", result.stdout)


if __name__ == "__main__":
    unittest.main()
