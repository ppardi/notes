#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Put the current working tree in front of a real iPad, without a release.
#
# The dev container already serves this repo's app directory, so a build is
# visible to it at once. What is not visible is the *browser's* copy: Nextcloud
# serves app JS with `max-age=15778463` and busts it with a query string built
# from the app version and the theming cachebuster. Bumping the cachebuster
# changes every asset URL, so the iPad fetches the new build on a reload - with
# no version bump, no `occ upgrade`, no release, and no restart of anything.
#
#   bash dev/ipad.sh            build, then bust the cache
#   bash dev/ipad.sh --no-build just bust the cache
#   bash dev/ipad.sh --dark     also switch the account to the dark theme
#   bash dev/ipad.sh --light    also switch it back
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${NOTES_DEV_CONTAINER:-nextcloud-e2e-test-server_NextCloud-Notes}"
PORT="${NOTES_DEV_PORT:-8089}"
USER_ID="${NOTES_DEV_USER:-admin}"

THEME=""
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --dark) THEME=dark ;;
    --light) THEME=light ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" = 1 ]; then
  echo "building…"
  cd "$REPO"
  # Webpack reports failures in the body of its output and still exits 0 for
  # some of them, so the log is searched rather than trusted to the status.
  BUILD="$(npm run build 2>&1)" || { echo "$BUILD" | tail -30; exit 1; }
  if echo "$BUILD" | grep -qE '^ERROR|ERROR in'; then
    echo "$BUILD" | grep -E -A5 '^ERROR|ERROR in' | head -40
    exit 1
  fi
  echo "$BUILD" | grep -E 'compiled' | tail -1
fi

# The e2e harness pins the theme: @nextcloud/e2e-test-server's configureNextcloud()
# sets `enforce_theme` to light so its screenshots are deterministic. An enforced
# theme is merged ahead of the account's own choice and wins, so Appearance
# settings silently do nothing until it is gone - which is why switching to dark
# by hand looks broken. Removing it here is safe: re-provisioning the container,
# or a Playwright run that reconfigures it, puts it back.
if [ -n "$THEME" ]; then
  docker exec --user www-data "$CONTAINER" \
    php occ config:system:delete enforce_theme >/dev/null 2>&1 || true
  docker exec --user www-data "$CONTAINER" \
    php occ user:setting "$USER_ID" theming enabled-themes "[\"$THEME\"]" >/dev/null
  echo "theme: $THEME"
fi

docker exec --user www-data "$CONTAINER" \
  php occ config:app:set theming cachebuster --value="$(date +%s)" >/dev/null
echo "cache busted"

# Whichever address the iPad can see. en0 is the usual Wi-Fi interface.
LAN="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN" ]; then
  echo "no LAN address found - is this Mac on Wi-Fi?" >&2
  exit 1
fi

if ! curl -fs -o /dev/null --max-time 5 "http://$LAN:$PORT/status.php"; then
  echo "the container is not answering on http://$LAN:$PORT - start it with dev/ensure-env.sh" >&2
  exit 1
fi

echo
echo "open on the iPad:  http://$LAN:$PORT/index.php/apps/notes"
echo "sign in as admin / admin, and pull to reload after each build"
