#!/bin/bash
# SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Package a release tarball for this fork.
#
# Must run under bash: the .nextcloudignore pass relies on glob matching that
# zsh does not do the same way.
#
# Writes to dev/out (or $NOTES_DEV_OUT):
#   notes-<version>.tar.gz   the app
#   SHA256SUMS               its checksum, named exactly as the release needs
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${NOTES_DEV_OUT:-$REPO/dev/out}"
V="$(sed -n 's|.*<version>\(.*\)</version>.*|\1|p' "$REPO/appinfo/info.xml" | head -1)"
STAGE="$OUT/stage-$V"
mkdir -p "$OUT"
echo "packaging notes $V"

rm -rf "$STAGE" && mkdir -p "$STAGE/notes"
# js/ is built output and git-ignored, so the archive carries none of it.
git -C "$REPO" archive HEAD | tar -x -C "$STAGE/notes"
[ -d "$REPO/js" ] || { echo "no js/ — run npm run build first" >&2; exit 1; }
cp -R "$REPO/js" "$STAGE/notes/js"

# Strip everything .nextcloudignore names, patterns and globs alike.
cd "$STAGE/notes"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in \#*) continue ;; esac
  p="${p#/}"
  for match in $p; do
    [ -e "$match" ] && rm -rf "$match"
  done
done < "$REPO/.nextcloudignore"
rm -f .nextcloudignore

cd "$STAGE"
COPYFILE_DISABLE=1 tar -czf "$OUT/notes-$V.tar.gz" notes
cd "$OUT"
# The release asset must be named exactly SHA256SUMS. A versioned name uploads
# fine and is then silently ignored by the installer that watches releases.
shasum -a 256 "notes-$V.tar.gz" > SHA256SUMS
cat SHA256SUMS
echo "contents: $(tar -tzf "notes-$V.tar.gz" | wc -l | tr -d ' ') entries"
rm -rf "$STAGE"
echo
echo "to publish:"
echo "  gh release create v$V --repo ppardi/notes --prerelease \\"
echo "    --title \"$V — <what it does>\" --notes-file <notes.md> \\"
echo "    \"$OUT/notes-$V.tar.gz\" \"$OUT/SHA256SUMS\""
