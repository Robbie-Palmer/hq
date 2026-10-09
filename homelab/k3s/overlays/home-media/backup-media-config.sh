#!/usr/bin/env bash
set -euo pipefail

# Nightly restic snapshots of the K3s media stack's app configuration, so an
# incident like the worktree wipe of 2026-09-12 cannot destroy app state
# again (see ADR 020 and the K3s migration).
#
# What gets backed up:
#   ~/.local/share/homelab/k3s/media/  (Jellyfin, Sonarr, Radarr, Prowlarr,
#   qBittorrent, Recyclarr configs + the gitignored .env credentials)
#
# The *arr apps and Jellyfin keep SQLite databases that must not be copied
# while mid-write, so every *.db is snapshotted through sqlite3's online
# .backup API into a staging directory; the live tree is backed up with the
# database files excluded and the staging tree included.
#
# Fail-closed: refuses to run unless the expected Expansion volume UUID is
# mounted. A mkdir lockfile prevents overlap.
#
# Restore: install restic (mise install), then
#   export RESTIC_REPOSITORY=/Volumes/Expansion/Backups/media-k3s
#   export RESTIC_PASSWORD_FILE=~/.local/share/homelab/k3s/media-backup.restic-pw
#   restic restore latest --tag media-config --target /tmp/restore
# Restic recreates both absolute source paths below /tmp/restore. Scale the
# media stack down, then restore the config and consistent database copies:
#   RESTORED_ROOT="/tmp/restore$HOME/.local/share/homelab/k3s"
#   rsync -a "$RESTORED_ROOT/media/" ~/.local/share/homelab/k3s/media/
#   rsync -a "$RESTORED_ROOT/media-db-snapshots/" ~/.local/share/homelab/k3s/media/
# Run the VPN gate to bring the stack back to its permitted replica count.

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

MEDIA_DATA_DIR="${MEDIA_DATA_DIR:-$HOME/.local/share/homelab/k3s/media}"
MEDIA_BACKUP_MOUNT_PATH="${MEDIA_BACKUP_MOUNT_PATH:-/Volumes/Expansion}"
MEDIA_BACKUP_VOLUME_UUID="${MEDIA_BACKUP_VOLUME_UUID:-808A2851-4126-3A7B-B23F-9E1C3ADD28E4}"
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-$MEDIA_BACKUP_MOUNT_PATH/Backups/media-k3s}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-$HOME/.local/share/homelab/k3s/media-backup.restic-pw}"
LOCK_DIR="${TMPDIR:-/tmp}/homelab-media-backup.lock"
LOCK_OWNER="$LOCK_DIR/owner"
# Stable path so restores are predictable; wiped and rebuilt every run.
STAGE_ROOT="$HOME/.local/share/homelab/k3s/media-db-snapshots"
LOG_TS="+%F %T"

log() { echo "$(date "$LOG_TS") $*"; }

process_start_identity() {
  ps -p "$1" -o lstart= 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

LOCK_START="$(process_start_identity "$$")"

write_lock_owner() {
  printf '%s\n%s\n' "$$" "$LOCK_START" > "$LOCK_OWNER"
}

cleanup() {
  local owner_pid owner_start
  owner_pid="$(sed -n '1p' "$LOCK_OWNER" 2>/dev/null || true)"
  owner_start="$(sed -n '2p' "$LOCK_OWNER" 2>/dev/null || true)"
  if [[ "$owner_pid" == "$$" && "$owner_start" == "$LOCK_START" ]]; then
    rm -f "$LOCK_OWNER"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

if mkdir "$LOCK_DIR" 2>/dev/null; then
  write_lock_owner
else
  owner_pid="$(sed -n '1p' "$LOCK_OWNER" 2>/dev/null || true)"
  owner_start="$(sed -n '2p' "$LOCK_OWNER" 2>/dev/null || true)"
  current_start=""
  if [[ "$owner_pid" =~ ^[0-9]+$ && -n "$owner_start" ]]; then
    current_start="$(process_start_identity "$owner_pid" || true)"
  fi
  if [[ -z "$owner_pid" || -z "$owner_start" || "$current_start" == "$owner_start" ]]; then
    log "another backup run holds the lock; exiting"
    exit 0
  fi

  stale_lock="$LOCK_DIR.stale.$$"
  if [[ -e "$stale_lock" ]] || ! mv "$LOCK_DIR" "$stale_lock" 2>/dev/null; then
    log "another backup run holds the lock; exiting"
    exit 0
  fi
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    rm -rf "$stale_lock"
    log "another backup run holds the lock; exiting"
    exit 0
  fi
  rm -rf "$stale_lock"
  write_lock_owner
  log "recovered stale backup lock owned by PID $owner_pid"
fi
trap cleanup EXIT

mounted_volume_uuid="$(
  /usr/sbin/diskutil info -plist "$MEDIA_BACKUP_MOUNT_PATH" 2>/dev/null \
    | /usr/bin/plutil -extract VolumeUUID raw - 2>/dev/null \
    || true
)"
if [[ "$mounted_volume_uuid" != "$MEDIA_BACKUP_VOLUME_UUID" ]]; then
  log "refusing to back up: the expected Expansion disk is not mounted"
  exit 1
fi
if [[ ! -d "$MEDIA_DATA_DIR" ]]; then
  log "refusing to back up: $MEDIA_DATA_DIR does not exist"
  exit 1
fi
case "$STAGE_ROOT" in
  "$HOME"/.local/share/homelab/*) ;;
  *) log "refusing to back up: unsafe staging path '$STAGE_ROOT'"; exit 1 ;;
esac

RESTIC_BIN=""
shopt -s nullglob
restic_candidates=("$HOME"/.local/share/mise/installs/aqua-restic-restic/*/restic)
shopt -u nullglob
for candidate in "${restic_candidates[@]}"; do
  [[ -x "$candidate" ]] && RESTIC_BIN="$candidate"
done
if [[ -z "$RESTIC_BIN" ]] && command -v restic >/dev/null 2>&1; then
  RESTIC_BIN="$(command -v restic)"
fi
if [[ -z "$RESTIC_BIN" ]]; then
  log "refusing to back up: restic not found (run 'mise install' in homelab/)"
  exit 1
fi
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

if [[ ! -f "$RESTIC_PASSWORD_FILE" ]]; then
  umask 077
  openssl rand -base64 32 > "$RESTIC_PASSWORD_FILE"
  log "generated restic repository password at $RESTIC_PASSWORD_FILE"
  log "store a copy of that file outside this machine; without it the snapshots are unrecoverable"
fi

if [[ ! -f "$RESTIC_REPOSITORY/config" ]]; then
  log "initializing restic repository at $RESTIC_REPOSITORY"
  "$RESTIC_BIN" init
fi

# Stage consistent copies of every SQLite database.
log "staging SQLite databases from $MEDIA_DATA_DIR"
rm -rf "$STAGE_ROOT"
mkdir -p "$STAGE_ROOT"
while IFS= read -r -d '' db; do
  rel="${db#"$MEDIA_DATA_DIR"/}"
  app_dir="$(dirname "$rel")"
  mkdir -p "$STAGE_ROOT/$app_dir"
  sqlite3 "$db" ".backup '$STAGE_ROOT/$app_dir/$(basename "$db")'"
done < <(find "$MEDIA_DATA_DIR" -name '*.db' -print0)

log "running restic backup"
"$RESTIC_BIN" backup "$MEDIA_DATA_DIR" "$STAGE_ROOT" \
  --exclude "$MEDIA_DATA_DIR/**/*.db" \
  --exclude "$MEDIA_DATA_DIR/**/*.db-wal" \
  --exclude "$MEDIA_DATA_DIR/**/*.db-shm" \
  --tag media-config
log "applying retention (7 daily, 4 weekly, 6 monthly)"
"$RESTIC_BIN" forget \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
  --prune --compact

log "backup complete"
