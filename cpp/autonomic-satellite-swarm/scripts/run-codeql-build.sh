#!/usr/bin/env bash

set -euo pipefail

mise run clean
mise run build
mise run firmware:uno
mise run firmware:esp32
