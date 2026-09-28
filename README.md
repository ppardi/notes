<!--
  - SPDX-FileCopyrightText: 2019-2024 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Notes — ppardi's build

A personal fork of [Nextcloud Notes](https://github.com/nextcloud/notes), built for
one server and shared in case it is useful to anyone else. It is not affiliated with
or endorsed by Nextcloud GmbH, and it is not in the app store.

It is the official app plus a handful of features, chiefly around **organising** notes
rather than writing them. Notes are still ordinary Markdown files in your Nextcloud, as
upstream intends, so nothing here locks anything in.

Built from upstream **6.1.0** and tracking the `6.1.x` line.

## What it adds

**A category tree.** Categories nest, and the sidebar shows the whole tree rather than a
flat list. Drag a category to move it, or drop one on a row's edge to place it at that
level. Which categories are collapsed is remembered against your account, the selected
category lives in the URL, and you come back to it on startup.

**Tags, written as hashtags.** A `#word` typed anywhere in a note becomes a tag. Tags are
listed in the sidebar and filter the note list, the editor completes one as you type it,
and renaming a tag rewrites every note carrying it. Tags are exposed in the REST API
alongside the rest of a note's metadata.

**Smart categories.** A category whose contents are a tag query, living in the tree
beside the real ones. Made from the Categories menu, named and given tags in one dialog,
set to match any or all of them, and filed wherever you want it. Placement is filing,
not filtering.

**Search that looks inside notes**, across every category rather than only the selected
one, from a box in the sidebar.

**Comments drawn as comments.** The Text app stores an annotation as a specially labelled
footnote; the preview used to show that raw syntax. Commented notes now render the author,
a timestamp in your own time zone, and replies threaded under one marker. Real footnotes
render too, numbered separately so a comment cannot take `[1]` from one.

**Folding sections under their headings**, in the rich text editor. The control beside a
heading puts its section out of sight, subsections with it, and says how much it is
holding back. Nothing is written to the file: a fold lasts while the note is open and
starts again from nothing, so it never follows the note onto anyone else's screen.

## Install

Requires Nextcloud **33–36** and PHP **8.2–8.5**. Section folding happens in the rich text
editor, so it needs the [Text](https://github.com/nextcloud/text) app. Comments are
written in Text but drawn by the preview, which works whether or not it is installed.

1. Download `notes-<version>.tar.gz` and `SHA256SUMS` from the newest entry on the
   [releases page](https://github.com/ppardi/notes/releases). Every build here is marked
   pre-release, so `releases/latest` does not resolve to one — take the topmost.
2. Check the download:
   ```
   shasum -a 256 -c SHA256SUMS
   ```
3. Extract it over your apps directory — **the whole directory, not just `js/`**.
4. Run the upgrade:
   ```
   sudo -u www-data php occ upgrade
   ```

**Between steps 3 and 4 the Notes app answers 503 on every request.** That is the version
bump waiting on the upgrade, not a broken build.

## How it relates to the official app

Versions are numbered `<upstream major>.99.<n>` — so this build reads as newer than
anything in the app store, and the store's updater cannot quietly replace it. That is
also why going back to the official app takes a forced install rather than an update.

Releases are marked pre-release. They are used daily on one server and tested on every
build (unit tests, end-to-end tests, lint), but they are one person's builds, not a
supported product. **Back your notes up before trying them.** Since notes are plain files
in your Nextcloud, that is the same backup you already have.

None of this has gone upstream. Some of it may be proposed one day; treat it as a fork
until then — so anything wrong with it belongs
[here](https://github.com/ppardi/notes/issues) rather than on the Nextcloud project's
tracker, unless you can reproduce it on the official app too.

---

# About Notes itself

What follows is upstream's own README, kept as it is, for what the Notes app is and how
to work on it. **Its installation and bug-reporting sections are about the official
app**, not this build — install this one from the releases above, and report problems
with it on [this fork's tracker](https://github.com/ppardi/notes/issues).

[![REUSE status](https://api.reuse.software/badge/github.com/nextcloud/notes)](https://api.reuse.software/info/github.com/nextcloud/notes)

<!-- The following paragraph should be kept synchronized with the description in appinfo/info.xml -->
The Notes app is a distraction free notes taking app for [Nextcloud](https://www.nextcloud.com/). It provides categories for better organization and supports formatting using [Markdown](https://en.wikipedia.org/wiki/Markdown) syntax. Notes are saved as files in your Nextcloud, so you can view and edit them with every Nextcloud client. Furthermore, a separate [REST API](https://github.com/nextcloud/notes/blob/master/docs/api/README.md) allows for an easy integration into apps ([Android](https://github.com/nextcloud/notes-android), [iOS](https://github.com/nextcloud/notes-ios), as well as [3rd-party apps](https://github.com/nextcloud/notes/wiki#3rd-party-clients) which allow convenient access to your Nextcloud notes). Further features include marking notes as favorites.

![Screenshot of Nextcloud Notes](https://raw.githubusercontent.com/nextcloud/screenshots/master/apps/Notes/notes.png)


## :rocket: Installation
In your Nextcloud, simply navigate to »Apps«, choose the category »Office«, find the Notes app and enable it. Then open the Notes app from the app menu.

Nextcloud will notify you about possible updates. Please have a look at [CHANGELOG.md](CHANGELOG.md) for details about changes.


## :exclamation: Bugs
Before reporting bugs:

* get the newest version of the Notes app
* please consider also installing the [latest development version](https://github.com/nextcloud/notes/archive/master.zip)
* [check if they have already been reported](https://github.com/nextcloud/notes/issues)


## :busts_in_silhouette: Maintainers
- [Kristof Hamann](https://github.com/korelstar)
- [Hendrik Leppelsack](https://github.com/Henni) (formerly)
- [Lukas Reschke](https://github.com/LukasReschke) (formerly)


## :warning: Developer Info

[![Lint](https://github.com/nextcloud/notes/workflows/Lint/badge.svg?branch=master&event=push)](https://github.com/nextcloud/notes/actions?query=workflow%3ALint+event%3Apush+branch%3Amaster)
[![Test](https://github.com/nextcloud/notes/workflows/Test/badge.svg?branch=master&event=push)](https://github.com/nextcloud/notes/actions?query=workflow%3ATest+event%3Apush+branch%3Amaster)

### Building the app

1. Clone this into your `apps` folder of your Nextcloud
2. In a terminal, run the command `make dev-setup` to install the dependencies
3. Then to build the Javascript run `make build-js` or `make watch-js` to
   rebuild it when you make changes
4. Enable the app through the app management of your Nextcloud


### REST API for third-party apps

The notes app provides a JSON-API for third-party apps. Please have a look at our **[API documentation](docs/api/README.md)**.


### Admin configuration

It is possible to specify different defaults for the notes settings of new users using `occ` commands like these:

```
occ config:app:set notes noteMode --value="preview"
occ config:app:set notes fileSuffix --value=".md"
occ config:app:set notes defaultFolder --value="Shared notes"
```

| Setting | Property name | Default | Other available option(s) |
|---------|---------------|---------|---------------------------|
| Display mode for notes | noteMode | edit | preview |
| File extension for new notes | fileSuffix | .txt | .md |
| Folder to store your notes | defaultFolder | Notes | _Custom_ |
