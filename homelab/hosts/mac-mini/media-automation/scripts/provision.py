#!/usr/bin/env python3
"""Wire the media automation services together via their REST APIs.

Reads connection details from the environment (exported by provision.sh):
  PROWLARR_PORT, SONARR_PORT, RADARR_PORT, QBITTORRENT_PORT,
  QBITTORRENT_PASSWORD, PROWLARR_API_KEY, SONARR_API_KEY, RADARR_API_KEY

Idempotent: existing indexers/apps/download clients/root folders are left
alone. Prints one summary line per action.
"""

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROWLARR = f"http://localhost:{os.environ.get('PROWLARR_PORT', '9696')}"
SONARR = f"http://localhost:{os.environ.get('SONARR_PORT', '8989')}"
RADARR = f"http://localhost:{os.environ.get('RADARR_PORT', '7878')}"
QBIT = f"http://localhost:{os.environ.get('QBITTORRENT_PORT', '8080')}"

# Public Cardigann definitions provisioned into Prowlarr and synced to the
# apps. The identifiers below are Prowlarr definition names required for
# provisioning to function; see ADR 017 for why this set spans several public
# trackers and why some well-known aggregators are excluded (their CDNs drop
# .NET TLS handshakes, so Prowlarr can never validate them).
INDEXER_DEFINITIONS = ["thepiratebay", "yts", "limetorrents", "torrentdownload"]
INDEXER_BASE_URLS = {
    "thepiratebay": "https://thepiratebay.org/",
}

SONARR_CATEGORY = "tv-sonarr"
RADARR_CATEGORY = "radarr"

# Trakt watchlist as the acquisition queue; see ADR 021. The username must be
# the canonical dashed slug from the profile URL - Trakt answers 200 [] for a
# misspelled one, which looks exactly like a broken connection.
TRAKT_USERNAME = os.environ.get("TRAKT_USERNAME", "robbie-palmer-1cefe3")
TRAKT_LIST_NAME = "Trakt Watchlist"
SONARR_PROFILE = "WEB-1080p"
RADARR_PROFILE = "HD Bluray + WEB"

# Container-internal endpoints on the private Compose network. TLS would
# require an internal CA to issue certificates for hostnames like "sonarr",
# so plain HTTP is intentional (Sonar S5332 suppressed at each definition).
SONARR_URL = "http://sonarr:8989"  # NOSONAR
RADARR_URL = "http://radarr:7878"  # NOSONAR
PROWLARR_URL = "http://prowlarr:9696"  # NOSONAR

RECYCLARR_CONFIG_DIR = os.path.join(
    os.environ.get("MEDIA_AUTOMATION_DIR", "."), "data", "recyclarr")

# TRaSH Guides starter profiles, see ADR 019. Recyclarr v8 has no include-by-
# name templates; the pre-built configs live in recyclarr/config-templates and
# are copied wholesale with base_url/api_key substituted.
# The ref is pinned to an immutable upstream commit so template content cannot
# change under us; bump it deliberately when adopting new guide revisions
# (quality-profile trash_id content still tracks the guides at every sync).
RECYCLARR_TEMPLATE_REF = "9faf65ff745d74ab906fd73cadaa25f08eb9d981"
RECYCLARR_TEMPLATES = [
    ("sonarr",
     "https://raw.githubusercontent.com/recyclarr/config-templates/"
     f"{RECYCLARR_TEMPLATE_REF}/"
     "sonarr/templates/web-1080p.yml"),
    ("radarr",
     "https://raw.githubusercontent.com/recyclarr/config-templates/"
     f"{RECYCLARR_TEMPLATE_REF}/"
     "radarr/templates/hd-bluray-web.yml"),
]


class Api:
    def __init__(self, base, key=None):
        self.base = base.rstrip("/")
        self.key = key

    def request(self, method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.key:
            req.add_header("X-Api-Key", self.key)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
                return json.loads(body) if body.strip() else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"{method} {path} unreachable: {exc.reason}") from exc

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, payload=None):
        return self.request("POST", path, payload)

    def put(self, path, payload=None):
        return self.request("PUT", path, payload)


def ensure_recyclarr_config():
    """Write the Recyclarr config with current API keys if it doesn't exist.

    An existing file is left alone so manual edits (extra profiles, custom
    format score overrides) survive re-provisioning.
    """
    from urllib.request import urlopen
    config_dir = RECYCLARR_CONFIG_DIR
    os.makedirs(config_dir, exist_ok=True)
    path = os.path.join(config_dir, "recyclarr.yml")
    keys = {"sonarr": os.environ["SONARR_API_KEY"],
            "radarr": os.environ["RADARR_API_KEY"]}
    if os.path.exists(path):
        print("Recyclarr: config already present")
        for app in keys:
            if keys[app] not in open(path).read():
                print(
                    f"  ! stored {app} API key not found in recyclarr.yml; "
                    f"if {app} was recreated, delete the file and re-provision"
                )
        return
    sections = []
    for app, url in RECYCLARR_TEMPLATES:
        with urlopen(url, timeout=60) as resp:
            template = resp.read().decode()
        # The generated config targets container hostnames over the private
        # Compose network; plain HTTP is intentional there (Sonar S5332).
        section = template.replace(
            f"Put your {app.capitalize()} URL here",
            f"http://{app}:_PORT_"  # NOSONAR
        ).replace(
            "Put your API key here", keys[app]
        ).replace("_PORT_", "8989" if app == "sonarr" else "7878")
        if "Put your" in section:
            raise SystemExit(
                f"{app} template placeholders did not match; the pinned "
                f"upstream template changed format and needs a provisioning fix"
            )
        sections.append(section)
    with open(path, "w") as fh:
        fh.write("\n".join(sections))
    os.chmod(path, 0o600)
    print(f"Recyclarr: wrote {path} from upstream TRaSH templates")


def run_initial_recyclarr_sync():
    """Trigger one sync immediately instead of waiting for the cron tick.

    The runtime commands come from the environment so the same logic drives
    the Compose stack and the K3s stack (see provision.sh variants).
    """
    import shlex
    import subprocess
    wait_cmd = shlex.split(os.environ.get(
        "RECYCLARR_WAIT_CMD", "docker inspect -f {{.State.Running}} recyclarr"))
    sync_cmd = shlex.split(os.environ.get(
        "RECYCLARR_SYNC_CMD", "docker exec recyclarr recyclarr sync"))
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            state = subprocess.run(
                wait_cmd, capture_output=True, text=True, timeout=30,
            ).stdout.strip()
        except subprocess.TimeoutExpired:
            state = ""
        if state in ("true", "Running"):
            break
        time.sleep(4)
    else:
        raise SystemExit("recyclarr never reported running; check its logs")
    result = subprocess.run(
        sync_cmd, capture_output=True, text=True, timeout=600,
    )
    output = (result.stdout + result.stderr).strip().splitlines()
    for line in output[-12:]:
        print(f"  {line}")
    if result.returncode != 0:
        raise SystemExit(
            f"recyclarr sync failed (exit {result.returncode}); check the "
            "template names in scripts/provision.py against recyclarr.dev"
        )
    print("Recyclarr: initial sync completed")


def wait_port(host, port, name, timeout=180):
    host_only = host.split("//")[1].split(":")[0]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host_only, int(port)), timeout=3):
                return
        except OSError:
            time.sleep(4)
    raise SystemExit(f"{name} did not open its port within {timeout}s")


def qbit_login_once(username, password):
    """Attempt a qBittorrent WebUI login; returns cookie string or None.

    Success is HTTP 200/204; 403 means this client IP is temporarily banned
    from too many failed attempts.
    """
    query = urllib.parse.urlencode({"username": username, "password": password})
    req = urllib.request.Request(
        f"{QBIT}/api/v2/auth/login", data=query.encode(), method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            if resp.status not in (200, 204):
                return None
            set_cookie = resp.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return None  # wrong password or temporary IP ban; caller falls back to the logged password
        raise RuntimeError(f"HTTP {exc.code}") from exc
    name = f"QBT_SID_{urllib.parse.urlparse(QBIT).port}="
    if name not in set_cookie:
        return None
    value = set_cookie.split(name, 1)[1].split(";", 1)[0]
    return f"{name}{value}"


def qbit_temp_password_from_logs():
    """Read the first-boot temporary WebUI password from container logs.

    Retries briefly: on a cold start the password line can land in the log
    a few seconds after the container reports running. The log command comes
    from the environment so Compose and K3s both work.
    """
    import shlex
    import subprocess
    log_cmd = shlex.split(os.environ.get("QBIT_LOG_CMD", "docker logs qbittorrent"))
    deadline = time.time() + 30
    while True:
        try:
            logs = subprocess.run(
                log_cmd, capture_output=True, text=True, timeout=30,
            )
            output = logs.stdout + logs.stderr
        except subprocess.TimeoutExpired:
            output = ""
        for line in output.splitlines():
            if "temporary password" in line.lower():
                return line.rsplit(":", 1)[-1].strip()
        if time.time() >= deadline:
            return None
        time.sleep(5)


def qbit_session():
    """Log into qBittorrent with the configured password.

    On a fresh install the WebUI has no stored password: qBittorrent prints a
    temporary one into its logs. Log in with it once and persist the generated
    password from .env via the API so later boots authenticate directly.
    Auth endpoints are hit at most twice to avoid tripping the ban-on-failures
    protection.
    """
    password = os.environ["QBITTORRENT_PASSWORD"]
    sid = qbit_login_once("admin", password)
    if sid:
        print("qBittorrent: authenticated with stored password")
        return sid

    temp = qbit_temp_password_from_logs()
    if not temp:
        raise SystemExit(
            "qBittorrent rejected the stored password and no first-boot temporary "
            "password was found in logs; wipe media-automation/data/qbittorrent "
            "and re-run //homelab:media-bootstrap"
        )
    sid = qbit_login_once("admin", temp)
    if not sid:
        raise SystemExit(
            "qBittorrent rejected even the logged temporary password (possibly "
            "banned after earlier failures; restart the container and re-run)"
        )
    body = urllib.parse.urlencode(
        {"json": json.dumps({"web_ui_password": password})}).encode()
    req = urllib.request.Request(
        f"{QBIT}/api/v2/app/setPreferences", data=body, method="POST",
        headers={"Cookie": sid, "Referer": QBIT},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
    check = qbit_login_once("admin", password)
    if not check:
        raise SystemExit(
            "qBittorrent rejected the new password immediately after setting it"
        )
    print("qBittorrent: permanent WebUI password set from first-boot credentials")
    return check


def qbittorrent_fields(password, category_field, category):
    return [
        {"name": "host", "value": "qbittorrent"},
        {"name": "port", "value": int(os.environ.get("QBITTORRENT_PORT", "8080"))},
        {"name": "useSsl", "value": False},
        {"name": "username", "value": "admin"},
        {"name": "password", "value": password},
        {"name": category_field, "value": category},
    ]


# Imports copy rather than hardlink (/downloads and /media are separate
# mounts, so a cross-device link always fails), and every indexer in the
# provisioned set is public, with no seed-ratio obligation. Remove the
# torrent and its data from qBittorrent once an import completes, or the
# raw download doubles the space of everything in the library.
REMOVE_COMPLETED = True


def ensure_download_client(app, category_field, category):
    existing = {dc.get("name") for dc in app.get("/api/v3/downloadclient")}
    if "qbittorrent" in existing:
        client = next(dc for dc in app.get("/api/v3/downloadclient")
                      if dc.get("name") == "qbittorrent")
        if (client.get("removeCompleted") != REMOVE_COMPLETED
                or client.get("removeCompletedDownloads") != REMOVE_COMPLETED):
            client["removeCompleted"] = REMOVE_COMPLETED
            client["removeCompletedDownloads"] = REMOVE_COMPLETED
            app.put(f"/api/v3/downloadclient/{client['id']}", client)
            print("  download client 'qbittorrent' updated (remove completed imports)")
        else:
            print("  download client 'qbittorrent' already present")
        return
    schema = next(
        dc for dc in app.get("/api/v3/downloadclient/schema")
        if dc.get("implementation") == "QBittorrent"
    )
    schema = json.loads(json.dumps(schema))
    schema.update({
        "name": "qbittorrent",
        "enable": True,
        "protocol": "torrent",
        "priority": 1,
        "removeCompletedDownloads": REMOVE_COMPLETED,
        "removeCompleted": REMOVE_COMPLETED,
    })
    schema["fields"] = qbittorrent_fields(
        os.environ["QBITTORRENT_PASSWORD"], category_field, category)
    app.post("/api/v3/downloadclient/test", schema)
    app.post("/api/v3/downloadclient", schema)
    print("  added download client 'qbittorrent' (connection test passed)")


def ensure_root_folder(app, path):
    if any(rf.get("path") == path for rf in app.get("/api/v3/rootfolder")):
        print(f"  root folder {path} already present")
        return
    app.post("/api/v3/rootfolder", {"path": path})
    print(f"  added root folder {path}")


def definition_of(indexer):
    for field in indexer.get("fields") or []:
        if field.get("name") == "definitionFile":
            return field.get("value")
    return None


def _indexer_schemas(prowlarr, wanted):
    schemas = {}
    # Right after startup the schema list can lag; retry until every wanted
    # definition shows up or the budget runs out.
    deadline = time.time() + 90
    while True:
        for entry in prowlarr.get("/api/v1/indexer/schema"):
            definition = next(
                (f.get("value") for f in entry.get("fields", [])
                 if f.get("name") == "definitionFile"),
                None,
            )
            if definition in wanted:
                schemas[definition] = entry
        if len(schemas) == len(wanted) or time.time() >= deadline:
            break
        time.sleep(6)
    return schemas


def _build_indexer_payload(prowlarr, definition, schema):
    payload = json.loads(json.dumps(schema))
    payload["name"] = definition
    payload["enable"] = True
    payload["tags"] = []
    if definition in INDEXER_BASE_URLS:
        for field in payload.get("fields", []):
            if field.get("name") == "baseUrl":
                field["value"] = INDEXER_BASE_URLS[definition]
    if not payload.get("appProfileId"):
        profiles = prowlarr.get("/api/v1/appprofile")
        if not profiles:
            raise SystemExit(
                "Prowlarr has no application profiles yet; wait for it to "
                "finish initializing and re-run provisioning"
            )
        standard = next((p["id"] for p in profiles if p.get("name") == "Standard"), None)
        payload["appProfileId"] = standard or profiles[0]["id"]
    return payload


def ensure_indexers(prowlarr):
    existing_defs = {definition_of(idx) for idx in prowlarr.get("/api/v1/indexer")}
    schemas = _indexer_schemas(prowlarr, set(INDEXER_DEFINITIONS))

    for definition in INDEXER_DEFINITIONS:
        if definition in existing_defs:
            print(f"  indexer '{definition}' already present")
            continue
        schema = schemas.get(definition)
        if schema is None:
            print(f"  ! definition '{definition}' not available in this Prowlarr; skipping")
            continue
        payload = _build_indexer_payload(prowlarr, definition, schema)
        result = prowlarr.post("/api/v1/indexer", payload)
        print(f"  added indexer '{result['name']}'")

    apps = prowlarr.get("/api/v1/applications")
    app_schemas = {e["implementation"]: e for e in prowlarr.get("/api/v1/applications/schema")}
    registered = []
    for implementation, base_url, key in (
        ("Sonarr", SONARR_URL, os.environ["SONARR_API_KEY"]),
        ("Radarr", RADARR_URL, os.environ["RADARR_API_KEY"]),
    ):
        if any(a.get("implementation") == implementation for a in apps):
            print(f"  application {implementation} already registered")
            continue
        schema = json.loads(json.dumps(app_schemas[implementation]))
        values = {f["name"]: f.get("value") for f in schema.get("fields", [])}
        values.update({
            "apiKey": key,
            "baseUrl": f"{base_url}/",
            "prowlarrUrl": PROWLARR_URL,
        })
        schema["fields"] = [{"name": k, "value": v} for k, v in values.items()]
        schema["name"] = implementation
        schema["enable"] = True
        schema["syncLevel"] = "fullSync"
        prowlarr.post("/api/v1/applications", schema)
        registered.append(implementation)
        print(f"  registered {implementation} for indexer sync")

    for path in ("/api/v1/applications/sync", "/api/v1/applications/testall"):
        try:
            prowlarr.request("POST", path, {})
            print(f"  triggered {path.rsplit('/', 1)[-1]}")
            break
        except RuntimeError as exc:
            last_error = str(exc)
    else:
        print(f"  note: manual sync unavailable ({last_error}); runs on schedule")




def ensure_trakt_list(app, app_name, root_folder, profile_name):
    """Verify the Trakt watchlist import list over the account's watchlist.

    Creating the list through the API requires the OAuth grant to already
    exist (Sonarr and Radarr validate accessToken/authUser on write), and
    that grant is an interactive 'Authenticate with Trakt' click per app -
    the one manual step of a fresh bootstrap (ADR 021, README caveats). So
    this reports state and prints the exact click-path; after the user
    creates and authorizes the list once, re-runs confirm it.
    """
    existing = [
        lst for lst in app.get("/api/v3/importlist")
        if lst.get("implementation") == "TraktUserImport"
    ]
    if existing:
        lst = existing[0]
        fields = {f["name"]: f.get("value") for f in lst.get("fields", [])}
        if fields.get("accessToken"):
            print(f"  {app_name}: '{lst['name']}' present and authorized")
        else:
            print(f"  {app_name}: '{lst['name']}' present; awaiting Trakt authorization")
            print(f"  {app_name}: open Settings > Lists > {lst['name']} and click "
                  "'Authenticate with Trakt'")
        username = fields.get("username")
        if username != TRAKT_USERNAME:
            print(f"  {app_name}: WARNING list username is {username!r}, expected "
                  f"the profile-slug {TRAKT_USERNAME!r}; the underscore variant "
                  "fetches an empty watchlist (ADR 021)")
        return

    print(f"  {app_name}: no Trakt list yet - create it once by hand (OAuth "
          "cannot be scripted):")
    print(f"    Settings > Lists > + Add List > Trakt User:")
    print(f"      name:               {TRAKT_LIST_NAME}")
    print(f"      username:           {TRAKT_USERNAME}  (profile URL slug, dashes)")
    print(f"      list type:          Watchlist")
    print(f"      root folder:        {root_folder}")
    print(f"      quality profile:    {profile_name}")
    print(f"      monitor / search:   everything, search on add")
    print(f"      then click 'Authenticate with Trakt' and Save")


def ensure_recycle_bin(app):
    """Point the app's recycle bin at the downloads volume (idempotent).

    Without it the *arr apps delete replaced/duplicate files permanently, so
    an import or quality-upgrade collision silently destroys data (observed
    during the k3s migration). Files land in /downloads/.recycle instead and
    can be restored by hand.
    """
    path = "/downloads/.recycle"
    config = app.get("/api/v3/config/mediamanagement")
    if config.get("recycleBin") == path:
        print(f"  recycle bin already set to {path}")
        return
    config["recycleBin"] = path
    app.put("/api/v3/config/mediamanagement", config)
    print(f"  recycle bin set to {path}")


def wait_for_synced_indexers(app, name, minimum=1, timeout=120):
    deadline = time.time() + timeout
    count = len(app.get("/api/v3/indexer"))
    while count < minimum and time.time() < deadline:
        time.sleep(6)
        count = len(app.get("/api/v3/indexer"))
    print(f"  {name}: {count} synced indexer(s)")
    return count


def main():
    prowlarr = Api(PROWLARR, os.environ["PROWLARR_API_KEY"])
    sonarr = Api(SONARR, os.environ["SONARR_API_KEY"])
    radarr = Api(RADARR, os.environ["RADARR_API_KEY"])

    wait_port(PROWLARR, os.environ.get("PROWLARR_PORT", "9696"), "Prowlarr")
    wait_port(SONARR, os.environ.get("SONARR_PORT", "8989"), "Sonarr")
    wait_port(RADARR, os.environ.get("RADARR_PORT", "7878"), "Radarr")
    wait_port(QBIT, os.environ.get("QBITTORRENT_PORT", "8080"), "qBittorrent")

    sid = qbit_session()
    prefs_req = urllib.request.Request(
        f"{QBIT}/api/v2/app/preferences", headers={"Cookie": sid})
    save_path = json.loads(urllib.request.urlopen(prefs_req, timeout=30).read()).get("save_path")
    print(f"qBittorrent: default save path {save_path}")

    print("Sonarr:")
    ensure_download_client(sonarr, "tvCategory", SONARR_CATEGORY)
    ensure_root_folder(sonarr, "/media/TV")
    ensure_recycle_bin(sonarr)
    print("Radarr:")
    ensure_download_client(radarr, "movieCategory", RADARR_CATEGORY)
    ensure_root_folder(radarr, "/media/Movies")
    ensure_recycle_bin(radarr)

    print("Prowlarr:")
    ensure_indexers(prowlarr)

    ensure_recyclarr_config()
    run_initial_recyclarr_sync()

    print("Indexer sync:")
    sonarr_ok = wait_for_synced_indexers(sonarr, "Sonarr")
    radarr_ok = wait_for_synced_indexers(radarr, "Radarr")
    if not (sonarr_ok and radarr_ok):
        print("  note: sync can take a couple of minutes on first run;")
        print("  re-run //homelab:media-provision to confirm.")
    else:
        print("Provisioning complete.")

    print("Trakt watchlists (ADR 021):")
    ensure_trakt_list(sonarr, "Sonarr", "/media/TV", SONARR_PROFILE)
    ensure_trakt_list(radarr, "Radarr", "/media/Movies", RADARR_PROFILE)


if __name__ == "__main__":
    sys.exit(main())
