#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Put the end-to-end server away without losing it.
#
# The container's /var/www/html/data is a tmpfs — the e2e harness mounts it in
# RAM for speed — so the database and every note live in memory and a plain
# `docker stop` throws them away. This copies that directory out first, then
# stops the container. `unpark.sh` puts it back.
#
# Everything else already survives a stop: config.php sits in the container's
# own layer and the apps are on a named volume.
set -euo pipefail
C=nextcloud-e2e-test-server_NextCloud-Notes
PARK="${NOTES_PARK_DIR:-$HOME/.cache/notes-e2e-park}"
ARCHIVE="$PARK/data.tar"

docker ps --format '{{.Names}}' | grep -q "^${C}$" || {
  echo "container is not running — nothing to park" >&2
  exit 1
}

mkdir -p "$PARK"
echo "putting the server into maintenance mode so the database is copied at rest…"
docker exec "$C" php /var/www/html/occ maintenance:mode --on > /dev/null

echo "copying the data directory out…"
docker exec "$C" tar -C /var/www/html -cf - data > "$ARCHIVE.part"

# Refuse to stop on a copy that did not work: the database is the whole point,
# and a stop with a bad archive is unrecoverable.
if ! tar -tf "$ARCHIVE.part" 2>/dev/null | grep -q '^data/owncloud\.db$'; then
  rm -f "$ARCHIVE.part"
  docker exec "$C" php /var/www/html/occ maintenance:mode --off > /dev/null
  echo "the copy has no database in it — left the container running" >&2
  exit 1
fi
mv "$ARCHIVE.part" "$ARCHIVE"
docker exec "$C" php /var/www/html/occ status 2>/dev/null | grep -E 'versionstring' > "$PARK/server.txt" || true

echo "stopping the container…"
docker stop "$C" > /dev/null
echo
echo "parked: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo "bring it back with ./dev/unpark.sh"
