#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Bring back the server that park.sh put away.
#
# The data directory is a tmpfs, so it comes up empty every time and has to be
# filled again before Nextcloud is any use. Restoring into a stopped container
# does not work: the tmpfs is created at start and would simply hide whatever
# was written underneath it.
set -euo pipefail
C=nextcloud-e2e-test-server_NextCloud-Notes
PARK="${NOTES_PARK_DIR:-$HOME/.cache/notes-e2e-park}"
ARCHIVE="$PARK/data.tar"

[ -f "$ARCHIVE" ] || { echo "nothing parked at $ARCHIVE" >&2; exit 1; }
docker ps -a --format '{{.Names}}' | grep -q "^${C}$" || {
  echo "the container is gone — park cannot restore one that no longer exists." >&2
  echo "re-provision instead: npm run start:nextcloud && ./dev/install-editor-apps.sh" >&2
  exit 1
}

echo "starting the container…"
docker start "$C" > /dev/null
# The tmpfs exists from the moment it starts; fill it before the server is
# asked for anything.
for i in $(seq 1 30); do
  docker exec "$C" true 2>/dev/null && break
  sleep 1
done

echo "restoring the data directory…"
docker exec -i "$C" tar -C /var/www/html -xf - < "$ARCHIVE"
docker exec -u root "$C" chown -R www-data:www-data /var/www/html/data
docker exec -u root "$C" chmod 0770 /var/www/html/data
docker exec "$C" php /var/www/html/occ maintenance:mode --off > /dev/null

echo "waiting for the server…"
until curl -sf -o /dev/null http://localhost:8089/status.php; do sleep 3; done
echo
echo "notes: $(curl -s -o /dev/null -w '%{http_code}' -u admin:admin http://localhost:8089/index.php/apps/notes/)  (200 means it is ready)"
docker exec "$C" php /var/www/html/occ app:list 2>/dev/null | grep -E 'notes:|text:|files_lock:'
