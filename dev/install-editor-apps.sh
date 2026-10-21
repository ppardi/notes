#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Put Text and Files Lock into the end-to-end container.
#
# Needed after every re-provision, because the container's data directory is a
# tmpfs and does not survive one. Neither app can come from the app store here:
# Text ships inside the Nextcloud server rather than in the store, and the
# store's files_lock is refused as incompatible with a development server. So
# Text is lifted out of the daily server tarball for the branch being tested,
# and files_lock is enabled from whatever the apps volume still holds.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BRANCH="${NEXTCLOUD_BRANCH:-stable35}"
# The e2e server names its container after the directory it was started from,
# so a git worktree gets a container of its own. Follow that rather than
# assuming the main checkout, or this installs into somebody else's server.
C="${NOTES_E2E_CONTAINER:-nextcloud-e2e-test-server_$(basename "$(dirname "$HERE")")}"
occ() { docker exec "$C" php /var/www/html/occ "$@"; }

if [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" != "true" ]; then
  echo "$C is not running - start it with 'npm run start:nextcloud' first" >&2
  exit 1
fi

if ! occ app:list 2>/dev/null | grep -q 'text:'; then
  echo "fetching Text from the $BRANCH daily server build…"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  (cd "$work" && curl -sL "https://download.nextcloud.com/server/daily/latest-$BRANCH.tar.bz2" \
     | tar -xj 'nextcloud/apps/text')
  [ -d "$work/nextcloud/apps/text" ] || { echo "could not extract Text from latest-$BRANCH" >&2; exit 1; }
  docker cp "$work/nextcloud/apps/text" "$C:/var/www/html/apps-writable/text"
  docker exec "$C" chown -R www-data:www-data /var/www/html/apps-writable/text
  occ app:enable text
fi

# The volume usually still carries files_lock even when the database has
# forgotten it; --force gets past the store's compatibility claim.
occ app:list 2>/dev/null | grep -q 'files_lock:' || occ app:enable --force files_lock

occ app:list 2>/dev/null | grep -E 'notes:|text:|files_lock:'
