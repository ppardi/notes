<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Category order

## Intent

A person arranges their categories the way they think about them, and the
arrangement stays put. Every notes app worth using allows this; ours sorts
alphabetically and offers no way to change it.

The sorting is also what makes the drag affordance dishonest. Dropping a
category between two rows draws a horizontal line — the universal signal for
"it lands here" — and then the tree re-sorts by name and puts it somewhere
else. The line promises precision the app does not have. Giving categories a
real order is what makes that line tell the truth, so the two problems are one
piece of work and this document covers both.

## Goals

- A category sits where it was put, across reloads and across devices.
- Dragging a category to a slot puts it in that slot. Nothing else moves.
- A category with children travels as a unit: the parent lands in the slot it
  was dropped in, its children keep their order among themselves.
- A new category appears at the top of its group.
- Smart categories take part in the same order as folder categories and can be
  placed anywhere among them.
- The drop affordance says which of the two things a drop will do, and both
  targets are comfortable to hit.

## Non-goals

- Ordering notes within a category. Only the category tree is in scope.
- Teaching the landing logic about the arrangement. It is removed instead —
  see "Where the app opens".
- Sorting controls of any kind — no "sort A-Z" menu, no per-group sort mode.
  The order is whatever the person arranged.
- Designing the order into the public REST API. Every key in
  `SettingsService` is served and accepted by `GET`/`PUT /api/v1/settings`, so
  adding the attribute exposes it there exactly as `collapsedCategories` and
  `smartCategories` already are, and that is fine: it is navigation state for
  this client. What is out of scope is treating it as an API contract — no
  documentation in `docs/api/`, no capability, and no promise to clients about
  its shape. It is deliberately *not* filtered out of the settings payload;
  nothing filters today and inventing a mechanism to hide one key would cost
  more than it is worth.
- Ordering anything the mobile clients render. They have their own navigation
  and will continue to sort as they see fit.

## Anti-goals

Things that would make this a failure even if it worked:

- **An order that drifts.** If a category moves on its own — because it was
  renamed, because a note was filed, because the list was reloaded — the
  feature is worse than alphabetical sorting, which at least never surprises
  anyone.
- **Writing settings because somebody looked at a list.** Opening the app must
  not persist anything. An order is recorded when a person arranges something,
  not when the tree is rendered.
- **A line that still lies.** If any drop can land somewhere other than where
  its affordance pointed, this work has not been done.

## Constraints

- A category is a folder in the user's files. Folders have no order, and the
  order must not be stored in the filesystem — no marker files, no renaming
  folders to carry a prefix.
- Categories can be created, renamed and deleted outside this app entirely
  (the Files app, a desktop client, another device). The order must cope with
  categories it has never seen and with ones that have vanished.
- The public REST API creates categories implicitly when a note is filed into
  one that does not exist. Those arrive without the app ever being involved.
- Settings are stored JSON and come back as untrusted input. Everything is
  capped and coerced on the way in, as `collapsedCategories` and
  `smartCategories` already are.

## The decisions already made

These came out of the conversation and are settled.

- **The order is stable.** Dragging moves one item; everything else stays
  exactly where it is.
- **A subtree travels with its parent**, children keeping their relative
  order.
- **A category created in the sidebar is recorded at the top of its group**, at
  the moment it is created. This holds for a smart category too: they are
  arranged together, so they are made the same way.
- **A category with no slot on record shows at the top of its group**, ordered
  by name among the other slotless ones, until its group is arranged.
  This covers folders made elsewhere and everything that predates the feature.
- **Smart categories are ordered alongside folder categories** and can be
  placed anywhere among them.
- **The horizontal line stays**, because a slot now means something.

### Calls made while writing this up

Flagged so they can be overruled while reading:

- **"Unfiled" is pinned to the top** of the top level and cannot be dragged or
  nested. It is not a folder; it already refuses to be a drag source or to
  take children.
- **Dropping onto a row nests the category at the top of that row's
  children**, consistent with the rule that anything without a recorded slot
  goes to the top.
- **A write records the whole destination group, not just the moved row.**
  Recording one key alone is incoherent: on an install where nothing has a
  slot yet, the moved category would become the only placed one and so render
  *below* every slotless sibling — the line would point at the top and the row
  would land at the bottom, which is the anti-goal this design exists to
  remove. So a drop, or a create, first snapshots that group's currently
  visible order and then applies the change to it. Every sibling gains a slot
  at once, nothing appears to move, and "slotless shows at the top" goes on
  applying to categories that turn up *later*.
- **A key whose group changes without being dropped is re-inserted at the top
  of its new group.** An index only means something relative to the siblings it
  is filtered against, so a key carried into a different group keeps a number
  that means nothing there. Two paths do this: renaming `Notes` to
  `Archive/Notes` in the inline field, which reparents it, and deleting a
  folder that holds a smart category, which lifts the smart category to the
  grandparent. Both re-insert at the top rather than keeping an index.
- **A smart category's row becomes a slot target but never a group target.**
  It can be dragged and placed like any other, and a folder category can be
  dropped into the slot above or below it. It takes no children, so the whole
  row is slot. Its present refusal of *note* drops stays exactly as it is —
  that refusal exists because a swallowed drop bubbles to the folder row the
  smart row sits inside and files the note where the pointer never was.
- **An order entry for a category that no longer exists is ignored, not
  pruned on sight.** A category can disappear from the listing for reasons
  that are not deletion — a sync in progress, a shared folder briefly
  unavailable — and forgetting its slot the moment it is missing would lose
  arrangements to transient absence. Deletion prunes it; absence does not.

## Where the app opens

The app already opens on the category it was last left in: `App.vue` reads the
stored `lastViewedCategory` and goes there when that category still exists.
Only when nothing is stored, or the stored category has since gone, does it
fall back — today to `landingCategory`, which picks the first category by
name, preferring a top-level one and one that holds notes.

**That fallback becomes the all-notes selection, and `landingCategory` is
deleted.** Every note is shown, whatever it is filed in, and nothing has to
know how the rest is arranged. The same applies to its other callers: after
deleting the category being viewed, and when the selection is cleared, the app
falls back to all notes rather than guessing.

The unfiled category was the first answer here and it was wrong: somebody
whose notes are all filed would open the app on an empty list, which is the
first thing a new device would show them. All-notes has one cost, accepted
knowingly — the sidebar has no row for it, so nothing is highlighted while
it is the selection.

This is what keeps the arrangement out of the landing logic entirely. A
function that picks "the first category by name" would be wrong the moment a
person arranges their categories, and teaching it the order would spread the
order into a third subsystem. Falling back to the selection that shows
everything is both simpler and more predictable: the app opens where it was
left, or on all of it.

**One interaction to watch.** The first-run welcome shows only when no
category is selected at all. The all-notes selection *is* nothing selected,
so a genuine first run still reaches it and the condition needs no change —
where landing on the unfiled category would have selected something and
shown "No notes in this category" where the welcome belongs. It stays as it
is: no notes anywhere **and** nothing selected. Relaxing it to notes alone
would tell somebody who has just made a category that they have never
written anything.

## Data model

A new user setting, `categoryOrder`: an ordered list of keys.

- A folder category's key is its path, exactly as the app uses it elsewhere:
  `Clients/Client1`.
- A smart category's key is its stable id, prefixed so it can never collide
  with a path. The prefix is the builder's choice; it must be one that
  `NoteUtil::sanitisePath` would never produce in a real path, so that a
  category cannot be named into a collision.

The list is flat and holds every level. A group's children are ordered by
their position in this list; a child absent from it sorts before all the
placed ones, by name.

Validated like its neighbours in `SettingsService`: array or nothing, strings
only, duplicates dropped, each key capped at 4096 characters and the list at
1000 entries, matching `collapsedCategories`. Because a write records a whole
group, the list holds roughly one entry per category, so the cap is a real
limit rather than a formality. **Overflow keeps the first 1000 keys and drops
the rest**, which surfaces the dropped categories at the top of their groups as
slotless rather than silently scrambling them.

A flat list is deliberate. The alternative — a map of parent to ordered
children — has to be rewritten on every rename, since a rename changes the
paths of everything beneath it. A flat list of paths is rewritten by the same
prefix substitution that already keeps smart categories in step.

## Behaviour

### Rendering

`categoryTree.js` builds the tree and currently sorts each level with
`localeCompare`. That sort is replaced by: slotless children first, by name;
then placed children, by their index in `categoryOrder`. Nothing else about
the build changes, and "Unfiled" stays pinned ahead of both.

Slotless-before-placed is only coherent because a write records the whole
group. A group is therefore either untouched — nothing placed, everything
name-sorted, exactly today's behaviour — or arranged, in which case the only
slotless rows are ones that have appeared since.

### Dropping

Two outcomes, each with its own affordance:

- **Into a slot** — a horizontal line between two rows, at that level. The
  category lands exactly there.
- **Into a group** — the destination row and its children take a shaded
  background. The category becomes a child of that row, at the top.

A smart category's row is all slot: it takes no children, so there is no group
target on it, and a folder category can be dropped above or below it like any
other row. Note drops on a smart row go on being refused exactly as they are
today.

Both targets must be comfortable to hit. The present split gives the middle
half of a row to nesting and 25% at each edge to placement, which on a 44px
row is about 11px of edge and is the reason the line appears and disappears.
The builder chooses the split; the requirement is that neither target is
harder to hit than the other, and that the two affordances are never shown at
once.

Moving a category to the top level keeps working. Dropping on the "Categories"
heading is the obvious gesture for it and the heading is already a drop
target; whether that or a slot at the top level is the mechanism is the
builder's call, as long as it is reachable from a deeply nested category.

### Keeping the order in step

Three events already have handlers that keep `smartCategories` in step, and
the order rides along with them:

- **Rename** — every key at or beneath the old path is rewritten to the new
  one. `reparentOnRename` in `src/smartCategories.js` is the model; this is
  the same prefix substitution over a list of strings.
- **Delete** — the deleted category's key and the keys of the folder
  categories beneath it are removed. `reparentOnDelete` is *not* the model
  here: it does the opposite, lifting a smart category that lived under the
  deleted folder up to the grandparent rather than removing it. A smart
  category's key is an id, so no prefix prune touches it; it survives, and it
  is re-inserted at the top of the group it has been lifted into.
- **Create** — the new category's key is inserted at the top of its group,
  which means immediately before the first existing key that belongs to that
  group.

### How a move composes

A move is up to two operations, and sometimes only one.

- **Reordering within the same parent** moves no folder. There is nothing to
  ask the server to do: it is a settings write and nothing else. This path is
  new — today `categorySiblingTarget` returns null when the move would leave a
  category where it already is, so dropping a category among its own siblings
  is refused before a line is even drawn.
- **Reparenting** is a folder rename *and* an order write. The rename goes
  first, because it is the operation that can fail for reasons outside the
  app — a name collision, a lock, a permission. Only once it returns is the
  order written, carrying the rewritten keys and the new slot. `smartCategories`
  is already written from this same handler after a rename; the order goes in
  **that same `setSettings` call**, not a second one, so there is one
  read-modify-write of the settings blob rather than two racing it.

If the rename succeeds and the settings write then fails, the category has
moved level and lost its slot: it shows at the top of its new group, among the
slotless. That is visible, harmless and fixed by dragging it again. **There is
no rollback.** Renaming the folder back is itself an operation that can fail,
and failing to undo leaves a worse state than the one being undone.

## What is left to the builder

- The prefix that distinguishes a smart category's key from a path.
- The hit-zone split between slot and group, and the exact look of the shaded
  group, within the requirement above.
- Whether moving to the top level is the heading or a top-level slot.
- Where the order is written from: the existing `setSettings` path is the
  obvious one, and the drag handlers already call it for `smartCategories`.
- How much of this is unit-testable in `src/tests/categoryTree.spec.js`
  against how much needs Playwright. The ordering rule is a pure function of
  the tree build and the order list, and should be tested as one; the drag
  affordance is not.

## Testing

The ordering rule belongs in `src/tests/categoryTree.spec.js` as unit tests:
slotless-before-placed, subtree travel, a slot that names a missing category,
a rename rewriting keys beneath it.

Playwright covers what only a browser shows: that a dropped category is where
it was dropped after a reload, that a new category appears at the top of its
group, that the line and the shaded group never appear together, and that
both targets can be hit. `playwright/e2e/category-tree.spec.ts` already has
the drag helpers; two of its tests assert the current name-sorted behaviour
and will need to change rather than merely be extended.

Note for whoever runs the e2e suite: it does not build — run `npm run build`
first — and a PHP change needs
`docker exec nextcloud-e2e-test-server_NextCloud-Notes apachectl -k graceful`,
because opcache holds the bind-mounted file.
