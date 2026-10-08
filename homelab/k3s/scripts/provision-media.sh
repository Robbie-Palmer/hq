#!/usr/bin/env bash
set -euo pipefail

# Provisions the K3s media stack: wires Prowlarr, Sonarr, Radarr, and
# qBittorrent together through their APIs and completes the Jellyfin
# first-run wizard. Safe to re-run. The compose equivalent lives under
# hosts/mac-mini/media-automation/scripts.
#
# Provisioning reaches out to public trackers (indexer validation, live
# searches), so refuse to run outside a VPN tunnel; see ADR 020.

# Append host paths without clobbering mise's tool paths (kubectl is
# mise-managed).
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

VPN_IFACE="$(route -n get 1.1.1.1 2>/dev/null | awk '/^ *interface:/{print $2}')"
case "$VPN_IFACE" in
  utun*) ;;
  *) echo "refusing to provision: default route is '${VPN_IFACE:-unset}', not a VPN tunnel (ADR 020)" >&2; exit 1 ;;
esac

CONTEXT="${MEDIA_KUBE_CONTEXT:-colima-homelab-k3s}"
NAMESPACE="${MEDIA_NAMESPACE:-media}"
MEDIA_DATA_DIR="${MEDIA_DATA_DIR:-$HOME/.local/share/homelab/k3s/media}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${MEDIA_DATA_DIR}/.env"

command -v kubectl >/dev/null || { echo "Missing kubectl" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Missing openssl" >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$MEDIA_DATA_DIR"
  umask 077
  qbit_password="$(openssl rand -hex 24)"
  jellyfin_password="$(openssl rand -base64 32)"
  {
    printf 'PROWLARR_PORT=9696\n'
    printf 'SONARR_PORT=8989\n'
    printf 'RADARR_PORT=7878\n'
    printf 'QBITTORRENT_PORT=8080\n'
    printf 'JELLYFIN_PORT=8096\n'
    printf 'QBITTORRENT_PASSWORD=%s\n' "$qbit_password"
    printf 'JELLYFIN_ADMIN_USER=admin\n'
    printf 'JELLYFIN_ADMIN_PASSWORD=%s\n' "$jellyfin_password"
  } > "$ENV_FILE"
  echo "Generated media application credentials in $ENV_FILE"
  echo "Back up this file before provisioning another machine."
fi

KUBECTL="kubectl --context $CONTEXT --namespace $NAMESPACE"

env_value() {
  local key="$1"
  grep -F "${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    || true
}

export PROWLARR_PORT="$(env_value PROWLARR_PORT)"; export PROWLARR_PORT="${PROWLARR_PORT:-9696}"
export SONARR_PORT="$(env_value SONARR_PORT)"; export SONARR_PORT="${SONARR_PORT:-8989}"
export RADARR_PORT="$(env_value RADARR_PORT)"; export RADARR_PORT="${RADARR_PORT:-7878}"
export QBITTORRENT_PORT="$(env_value QBITTORRENT_PORT)"; export QBITTORRENT_PORT="${QBITTORRENT_PORT:-8080}"
export JELLYFIN_PORT="$(env_value JELLYFIN_PORT)"; export JELLYFIN_PORT="${JELLYFIN_PORT:-8096}"
export QBITTORRENT_PASSWORD="$(env_value QBITTORRENT_PASSWORD)"
[[ -n "$QBITTORRENT_PASSWORD" ]] || { echo "QBITTORRENT_PASSWORD missing in $ENV_FILE" >&2; exit 1; }

TRAKT_USERNAME="$(env_value TRAKT_USERNAME)"
if [[ -n "$TRAKT_USERNAME" ]]; then
  export TRAKT_USERNAME
fi

# provision.py reads container logs and drives recyclarr through the
# container runtime; point it at the K3s equivalents.
export QBIT_LOG_CMD="kubectl --context $CONTEXT --namespace $NAMESPACE logs deployment/qbittorrent"
export RECYCLARR_WAIT_CMD="kubectl --context $CONTEXT --namespace $NAMESPACE get pod --selector app.kubernetes.io/name=recyclarr --output jsonpath={.items[0].status.phase}"
export RECYCLARR_SYNC_CMD="kubectl --context $CONTEXT --namespace $NAMESPACE exec deployment/recyclarr -- recyclarr sync"

# provision.py writes the Recyclarr config under $MEDIA_AUTOMATION_DIR/data,
# which the recyclarr persistent volume maps into the pod.
export MEDIA_AUTOMATION_DIR="$MEDIA_DATA_DIR"
mkdir -p "$MEDIA_DATA_DIR/data/recyclarr"

wait_for_deployments() {
  echo "Waiting for media deployments to become available..."
  $KUBECTL wait --for=condition=available --timeout=300s \
    deployment/prowlarr deployment/sonarr deployment/radarr \
    deployment/qbittorrent deployment/jellyfin
}

api_key() {
  sed -n 's/.*<ApiKey>\(.*\)<\/ApiKey>.*/\1/p' "$MEDIA_DATA_DIR/$1/config.xml" 2>/dev/null | head -1
}

wait_for_key() {
  local app="$1" name="$2" key=""
  for _ in $(seq 1 40); do
    key="$(api_key "$app")"
    [[ -n "$key" ]] && { echo "$key"; return 0; }
    sleep 3
  done
  echo "Timed out waiting for $name API key in $MEDIA_DATA_DIR/$app/config.xml" >&2
  return 1
}

wait_for_deployments

# Jellyfin Trakt plugin (ADR 021): pinned v30 carries the fix for a
# MissingMethodException under Jellyfin 10.11. Installed manually and
# checksum-verified so a fresh bootstrap does not rely on the dashboard
# catalog; Jellyfin loads it on the next pod start.
TRAKT_PLUGIN_VERSION="30.0.0.0"
TRAKT_PLUGIN_SHA256="61e7b311de2d113d2d0656135d5656740cfc27e000e2dba5aa4e9aa150d43faa"
TRAKT_PLUGIN_DIR="${MEDIA_DATA_DIR}/jellyfin/plugins/Trakt/${TRAKT_PLUGIN_VERSION}"
if [[ -f "${TRAKT_PLUGIN_DIR}/Trakt.dll" ]]; then
  echo "Trakt plugin ${TRAKT_PLUGIN_VERSION} already installed."
else
  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT
  curl -fsSL --proto '=https' --tlsv1.2 \
    "https://github.com/jellyfin/jellyfin-plugin-trakt/releases/download/v${TRAKT_PLUGIN_VERSION%%.*}/trakt_${TRAKT_PLUGIN_VERSION}.zip" \
    -o "${workdir}/trakt.zip"
  echo "${TRAKT_PLUGIN_SHA256}  ${workdir}/trakt.zip" | shasum -a 256 -c - \
    || { echo "Trakt plugin checksum mismatch" >&2; exit 1; }
  unzip -o -q "${workdir}/trakt.zip" -d "${workdir}/plugin"
  mkdir -p "$TRAKT_PLUGIN_DIR"
  cp "${workdir}/plugin/Trakt.dll" "${workdir}/plugin/meta.json" "$TRAKT_PLUGIN_DIR/"
  echo "Installed Trakt plugin ${TRAKT_PLUGIN_VERSION}; restarting Jellyfin to load it"
  $KUBECTL delete pod --selector app.kubernetes.io/name=jellyfin >/dev/null
  $KUBECTL wait --for=condition=available --timeout=300s deployment/jellyfin
fi

export PROWLARR_API_KEY="$(wait_for_key prowlarr "Prowlarr")"
export SONARR_API_KEY="$(wait_for_key sonarr "Sonarr")"
export RADARR_API_KEY="$(wait_for_key radarr "Radarr")"

python3 "$REPO_DIR/hosts/mac-mini/media-automation/scripts/provision.py"

# Complete the Jellyfin wizard and create the media libraries (same flow as
# the compose provision.sh, driven against the K3s service port).
BASE_URL="http://localhost:${JELLYFIN_PORT}"
ADMIN_USER="$(env_value JELLYFIN_ADMIN_USER)"
ADMIN_PASS="$(env_value JELLYFIN_ADMIN_PASSWORD)"
if [[ -z "$ADMIN_USER" || -z "$ADMIN_PASS" ]]; then
  echo "JELLYFIN_ADMIN_USER / JELLYFIN_ADMIN_PASSWORD missing in $ENV_FILE; skipping Jellyfin wizard" >&2
else
  AUTH_HEADER='MediaBrowser Client="provision", Device="mac-mini", DeviceId="provision-cli", Version="1.0"'
  CONTENT_TYPE='Content-Type: application/json'

  status="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/Startup/Configuration")"
  if [[ "$status" == "200" ]]; then
    echo "Completing Jellyfin first-run wizard"
    curl -s --max-time 10 -X POST "$BASE_URL/Startup/Configuration" \
      -H "$CONTENT_TYPE" \
      -d '{"ServerName":"Mac Mini","UICulture":"en-GB","MetadataCountryCode":"GB","PreferredMetadataLanguage":"en"}' \
      -o /dev/null -w "  startup configuration: %{http_code}\n"
    # Jellyfin 10.11 no longer creates the first user in the wizard: GET
    # /Startup/FirstUser initializes the default user, then POST /Startup/User
    # renames it and sets its password.
    first_user="$(curl -s --max-time 10 "$BASE_URL/Startup/FirstUser" \
      | jq -r '.Name // empty')"
    echo "  initialized default user: ${first_user:-none}"
    user_json="$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" '{Name: $u, Password: $p}')"
    curl -s --max-time 10 -X POST "$BASE_URL/Startup/User" \
      -H "$CONTENT_TYPE" -d "$user_json" \
      -o /dev/null -w "  admin user: %{http_code}\n"
    curl -s --max-time 10 -X POST "$BASE_URL/Startup/Complete" \
      -o /dev/null -w "  wizard complete: %{http_code}\n"
  else
    echo "Jellyfin wizard already complete; skipping"
  fi

  auth_json="$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" '{Username: $u, Pw: $p}')"
  TOKEN="$(curl -s --max-time 10 -X POST "$BASE_URL/Users/AuthenticateByName" \
    -H "$CONTENT_TYPE" -H "X-Emby-Authorization: $AUTH_HEADER" \
    -d "$auth_json" | jq -r .AccessToken)"
  if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
    add_library() {
      local name="$1" type="$2" path="$3"
      if curl -s --max-time 10 "$BASE_URL/Library/VirtualFolders" -H "X-Emby-Token: $TOKEN" \
          | jq -e --arg n "$name" 'any(.[]; .Name == $n)' >/dev/null 2>&1; then
        echo "  library '$name' already exists; skipping"
        return
      fi
      local name_enc type_enc path_enc
      name_enc="$(jq -rn --arg v "$name" '$v|@uri')"
      type_enc="$(jq -rn --arg v "$type" '$v|@uri')"
      path_enc="$(jq -rn --arg v "$path" '$v|@uri')"
      echo "  adding $name library ($path)"
      curl -s --max-time 15 -X POST \
        "$BASE_URL/Library/VirtualFolders?name=$name_enc&collectionType=$type_enc&paths=$path_enc&refreshLibrary=true" \
        -H "$CONTENT_TYPE" -H "X-Emby-Token: $TOKEN" \
        -d '{"libraryOptions":{"enableRealtimeMonitor":true}}' \
        -o /dev/null -w "  $name: %{http_code}\n"
    }
    add_library "TV Shows" "tvshows" "/media/TV"
    add_library "Movies" "movies" "/media/Movies"
  else
    echo "Jellyfin admin authentication failed; log in manually to create libraries" >&2
  fi
fi

echo ""
echo "Media stack provisioned. Jellyfin: http://localhost:${JELLYFIN_PORT}"
