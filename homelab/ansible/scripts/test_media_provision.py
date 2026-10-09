import importlib.util
import pathlib
import subprocess
import unittest
from unittest import mock


PROVISION_PATH = (
    pathlib.Path(__file__).parents[2]
    / "hosts"
    / "mac-mini"
    / "media-automation"
    / "scripts"
    / "provision.py"
)
SPEC = importlib.util.spec_from_file_location("media_provision", PROVISION_PATH)
assert SPEC is not None and SPEC.loader is not None
media_provision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media_provision)


class FakeApi:
    def __init__(self, responses):
        self.responses = responses
        self.puts = []

    def get(self, path):
        return self.responses[path]

    def put(self, path, payload):
        self.puts.append((path, payload))


class MediaProvisionTests(unittest.TestCase):
    def test_updates_existing_download_client_cleanup_policy(self):
        client = {
            "id": 7,
            "name": "qbittorrent",
            "removeCompleted": False,
            "removeCompletedDownloads": False,
        }
        api = FakeApi({"/api/v3/downloadclient": [client]})

        media_provision.ensure_download_client(api, "tvCategory", "tv-sonarr")

        self.assertEqual(
            api.puts,
            [("/api/v3/downloadclient/7", {
                **client,
                "removeCompleted": True,
                "removeCompletedDownloads": True,
            })],
        )

    def test_leaves_matching_download_client_unchanged(self):
        client = {
            "id": 7,
            "name": "qbittorrent",
            "removeCompleted": True,
            "removeCompletedDownloads": True,
        }
        api = FakeApi({"/api/v3/downloadclient": [client]})

        media_provision.ensure_download_client(api, "tvCategory", "tv-sonarr")

        self.assertEqual(api.puts, [])

    def test_sets_recycle_bin(self):
        config = {"id": 1, "recycleBin": ""}
        api = FakeApi({"/api/v3/config/mediamanagement": config})

        media_provision.ensure_recycle_bin(api)

        self.assertEqual(
            api.puts,
            [("/api/v3/config/mediamanagement", {
                "id": 1,
                "recycleBin": "/downloads/.recycle",
            })],
        )

    def test_recyclarr_wait_timeout_remains_within_polling_deadline(self):
        with (
            mock.patch(
                "subprocess.run",
                side_effect=subprocess.TimeoutExpired(["wait"], 30),
            ),
            mock.patch.object(media_provision.time, "time", side_effect=[0, 0, 121]),
            mock.patch.object(media_provision.time, "sleep"),
        ):
            with self.assertRaisesRegex(SystemExit, "never reported running"):
                media_provision.run_initial_recyclarr_sync()

    def test_qbittorrent_log_timeout_remains_within_polling_deadline(self):
        with (
            mock.patch(
                "subprocess.run",
                side_effect=subprocess.TimeoutExpired(["logs"], 30),
            ),
            mock.patch.object(media_provision.time, "time", side_effect=[0, 31]),
        ):
            self.assertIsNone(media_provision.qbit_temp_password_from_logs())


if __name__ == "__main__":
    unittest.main()
