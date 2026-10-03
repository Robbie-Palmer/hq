#!/usr/bin/env bash
set -euo pipefail

previous_apparmor_restriction=
restore_apparmor_restriction() {
  if [ -n "$previous_apparmor_restriction" ]; then
    sudo sysctl --write \
      "kernel.apparmor_restrict_unprivileged_userns=$previous_apparmor_restriction"
  fi
}
trap restore_apparmor_restriction EXIT

if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  previous_apparmor_restriction=$(sysctl --values kernel.apparmor_restrict_unprivileged_userns)
  sudo sysctl --write kernel.apparmor_restrict_unprivileged_userns=0
fi

mise run //homelab:t3-image-build
mise run //homelab:t3-image-check
