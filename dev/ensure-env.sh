#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Bring the end-to-end server up, ready for Playwright to reuse.
#
# Two things put it out of action, and this clears both:
#   - a version bump in appinfo/info.xml leaves the instance wanting an
#     upgrade, and every request to the app answers 503 until occ upgrade runs.
#     Wait on status.php, never on the notes url, when asking whether the
#     container is up;
#   - a re-provision loses Text and Files Lock, because the container's data
#     directory is a tmpfs.
#
# If the container is ever killed, the database and every note go with it:
#   docker rm -f nextcloud-e2e-test-server_NextCloud-Notes
#   npm run start:nextcloud
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
C=nextcloud-e2e-test-server_NextCloud-Notes
NOTES=http://localhost:8089/index.php/apps/notes/

occ() { docker exec "$C" php /var/www/html/occ "$@"; }
notes_code() { curl -s -o /dev/null -w '%{http_code}' -u admin:admin "$NOTES"; }

if ! docker ps --format '{{.Names}}' | grep -q "^${C}$"; then
  echo "starting the container…"
  (cd "$REPO" && npm run start:nextcloud > "$HERE/out/ncserver.log" 2>&1 &) || true
  until curl -sf -o /dev/null http://localhost:8089/status.php; do sleep 5; done
fi

if [ "$(notes_code)" != "200" ]; then
  echo "notes answers $(notes_code) — running occ upgrade…"
  occ upgrade || true
  occ maintenance:mode --off > /dev/null 2>&1 || true
fi

occ app:list 2>/dev/null | grep -q 'text:' || "$HERE/install-editor-apps.sh" > /dev/null

echo "notes url: $(notes_code)   (200 means Playwright will reuse this container)"
occ app:list 2>/dev/null | grep -E 'notes:|text:|files_lock:'
