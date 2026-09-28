<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Development scripts

Tooling for this fork. None of it ships: `/dev/` is excluded from the release
tarball by `.nextcloudignore`.

| Script | What it does |
| --- | --- |
| `ensure-env.sh` | Brings the end-to-end container up and ready for Playwright to reuse. Runs `occ upgrade` when a version bump has left the app answering 503, and reinstalls the editor apps if they are missing. |
| `install-editor-apps.sh` | Puts Text and Files Lock back after a re-provision. |
| `package-release.sh` | Builds the release tarball and its `SHA256SUMS`, into `dev/out`. |

## The server the container runs

`NEXTCLOUD_BRANCH` picks it, and defaults to **stable35** — the version this
build is deployed on. Text is taken from the same branch's daily tarball, so
the editor under test is the editor in production:

| Nextcloud | Text |
| --- | --- |
| stable35 | 9.0.0 |
| master | 10.0.0-dev |

```
NEXTCLOUD_BRANCH=master npm run start:nextcloud   # to test against the next release
```

## Things that will bite

**The container's `/var/www/html/data` is a tmpfs.** If the container is
killed, the database and every note in it are gone and only a re-provision
brings it back:

```
docker rm -f nextcloud-e2e-test-server_NextCloud-Notes
npm run start:nextcloud
./dev/install-editor-apps.sh
```

**Neither editor app comes from the app store here.** Text ships inside the
Nextcloud server rather than in the store, and the store's `files_lock` is
refused as incompatible with a development server.

**A version bump makes the app answer 503** on every request until
`occ upgrade` runs. Wait on `status.php`, never on the notes url.

**The `SHA256SUMS` release asset must be named exactly that.** A versioned name
uploads happily and is then ignored by the installer that watches releases.
