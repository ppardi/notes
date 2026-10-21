<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Category Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categories keep the order a person arranges them in, and the drop affordance tells the truth about where a drag will land.

**Architecture:** A new user setting `categoryOrder` holds a flat, ordered list of keys — a folder category's path, or a smart category's id behind a prefix. A new pure module `src/categoryOrder.js` owns every rule about that list; `categoryTree.js` consults it instead of sorting by name, and `CategoriesList.vue` writes it on drop, create, rename and delete. Writing records a whole group at once, which is what makes "slotless sorts first" coherent.

**Tech Stack:** Vue 3 + Pinia, Vitest for unit tests, Playwright for e2e, PHP (Nextcloud app) for the setting's validation.

**Spec:** `docs/superpowers/specs/2026-10-21-category-order-design.md`

## Global Constraints

- The order lives only in the `categoryOrder` user setting. **Never** in the filesystem — no marker files, no folder-name prefixes.
- Rendering never writes settings. An order is recorded when somebody arranges something, not when a tree is built.
- Cap: 1000 keys, each at most 4096 characters, matching `collapsedCategories`. Overflow keeps the first 1000 and drops the rest.
- The smart-category key prefix must be a string `NoteUtil::sanitisePath` can never produce in a real category path. `sanitisePath` strips `* | / \ : " < > ?` per segment and strips leading dots and whitespace.
- "Unfiled" (the empty-string category) is pinned to the top of the top level. It is never a drag source, never takes children, and never appears in `categoryOrder`.
- An order entry naming a category that is not in the current listing is ignored, not pruned.
- Conventional commits. Every commit carries `Assisted-by: Claude Code:claude-opus-5` and `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **Never** `Signed-off-by`.
- **`composer run test:unit` does not work** — phpunit is not in `require-dev`. PHP behaviour is proven through Playwright, not PHP unit tests.
- `npm run test:e2e` does **not** build. Run `npm run build` first. A PHP change needs `docker exec nextcloud-e2e-test-server_NextCloud-Notes apachectl -k graceful`, because opcache holds the bind-mounted file.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has a test in the task named.

1. **A category named so its path collides with the smart-category prefix** — a person can name a category anything `sanitisePath` allows. Expected: no folder category can ever be read as a smart key. (Task 1)
2. **An order holding keys for categories that are not in the listing** — the common state after deleting a folder in the Files app, or mid-sync. Expected: the tree renders, the surviving keys keep their relative order. (Task 1)
3. **Overflowing the 1000-key cap** — a person with many categories arranges one more. Expected: the first 1000 survive in order and the rest render as slotless at the top, never scrambled. (Task 4)
4. **Dropping a category into its own subtree** — already refused today by `categoryDropTarget`. Expected: still refused, and no order is written. (Task 5)
5. **Dragging a smart category into a slot** — smart categories are draggable today and `moveSmart` changes their parent; placing one must also record its key. Expected: a smart category dropped into a slot stays there across a reload, exactly as a folder category does. (Task 5)

## What this plan deliberately does not copy

`applyCollapsed` in `src/components/CategoriesList.vue:262` prunes
`collapsedCategories` against the categories currently in the tree **and
writes the result back** whenever it has changed. It is the nearest thing in
the codebase to what this feature does, and it is the wrong model for two of
the three things it demonstrates:

- **It prunes entries for categories that are not in the listing.** The order
  must not. A collapsed entry for a vanished category does nothing, so
  dropping it costs nothing; an order entry is an arrangement, and dropping it
  because a shared folder was briefly unreachable loses work that cannot be
  recovered. This asymmetry is deliberate — do not make the two consistent.
- **It writes settings from a render path.** The order never does. It is
  written when somebody arranges something, and at no other time.

Two things the review checked and found safe, recorded so nobody has to
check them again:

- `pruneCollapsed` filters the *stored* list rather than mapping over the
  tree's names, so changing the tree's order does not change the pruned
  list's order, and `applyCollapsed`'s equality check will not start writing
  settings on every render once categories stop being name-sorted.
- `withSmartCategories` has exactly one caller outside the tests
  (`CategoriesList.vue:199`) and `buildCategoryTree` has none, so giving both
  a trailing `order = []` parameter cannot reach code this plan has not read.

## File Structure

| File | Responsibility |
|---|---|
| `src/categoryOrder.js` | **New.** Every rule about the order list: the key for a node, ordering a level, recording a group, moving a key, and following renames and deletes. Pure functions, no store access. |
| `src/tests/categoryOrder.spec.js` | **New.** Unit tests for the above. |
| `src/categoryTree.js` | Consults the order instead of sorting by name. Loses `landingCategory`. |
| `lib/Service/SettingsService.php` | Declares and validates `categoryOrder`. |
| `src/components/CategoriesList.vue` | Writes the order on drop, create, rename and delete; computes the drop target. |
| `src/components/CategoryTreeItem.vue` | The slot line and the shaded group. |
| `src/components/SmartCategoryTreeItem.vue` | Accepts category drops as a slot; still refuses note drops. |
| `src/components/NotesView.vue` | First run means no notes anywhere. |
| `src/App.vue` | Falls back to unfiled rather than `landingCategory`. |

---

### Task 1: The order key and the ordering rule

**Files:**
- Create: `src/categoryOrder.js`
- Create: `src/tests/categoryOrder.spec.js`
- Modify: `src/categoryTree.js` (the `sort` helper at :83-86, `buildCategoryTree` at :29, `withSmartCategories` at :292 and its re-sort at :339)

**Interfaces:**
- Produces:
  - `SMART_PREFIX` — the constant `'smart:'`. A path cannot contain `:`; `sanitisePath` strips it.
  - `orderKey(node: CategoryNode) => string` — `SMART_PREFIX + node.id` when `node.smart`, else `node.name`.
  - `orderedLevel(level: CategoryNode[], order: string[]) => CategoryNode[]` — a new array: nodes whose key is absent from `order` first, sorted by `label` with `localeCompare`; then nodes whose key is present, by index in `order`.
  - `buildCategoryTree(categories, order = [])` and `withSmartCategories(categories, smartCategories, countFor, order = [])` — both gain a trailing optional `order`.

- [ ] **Step 1: Write the failing tests** in `src/tests/categoryOrder.spec.js`

```js
describe('orderKey', () => {
	it('is the path for a folder category', () => {
		expect(orderKey({ name: 'Clients/Client1' })).toBe('Clients/Client1')
	})
	it('is the prefixed id for a smart category', () => {
		expect(orderKey({ smart: true, id: 'abc', name: 'Urgent' })).toBe('smart:abc')
	})
	/* Review Focus 1: no real category can collide with a smart key.
	   NoteUtil::sanitisePath strips ':' from every path segment, so a person
	   who types "smart:abc" as a category name gets the folder "smartabc".
	   The test pins the half that lives in this file: a node without
	   `smart: true` is keyed by its name, whatever that name looks like. */
	it('keys a folder category by name even if it looks like a smart key', () => {
		expect(orderKey({ name: 'smartabc' })).toBe('smartabc')
		expect(orderKey({ name: 'smartabc' }).startsWith(SMART_PREFIX)).toBe(false)
	})

	it('keeps the unfiled category out of the order entirely', () => {
		expect(orderKey({ name: '', label: '' })).toBe('')
	})
})

describe('orderedLevel', () => {
	const node = (name, label = name) => ({ name, label, children: [] })

	it('puts placed nodes in the order given', () => {
		const level = [node('Beta'), node('Alpha'), node('Gamma')]
		const names = orderedLevel(level, ['Gamma', 'Alpha', 'Beta']).map((n) => n.name)
		expect(names).toEqual(['Gamma', 'Alpha', 'Beta'])
	})

	it('puts slotless nodes first, by label', () => {
		const level = [node('Placed'), node('Zulu'), node('Alpha')]
		const names = orderedLevel(level, ['Placed']).map((n) => n.name)
		expect(names).toEqual(['Alpha', 'Zulu', 'Placed'])
	})

	/* Review Focus 2: an order naming categories that are not here. */
	it('ignores keys for categories that are not in the level', () => {
		const level = [node('Beta'), node('Alpha')]
		const names = orderedLevel(level, ['Gone', 'Beta', 'AlsoGone', 'Alpha']).map((n) => n.name)
		expect(names).toEqual(['Beta', 'Alpha'])
	})

	it('leaves the given level untouched', () => {
		const level = [node('Beta'), node('Alpha')]
		orderedLevel(level, ['Alpha'])
		expect(level.map((n) => n.name)).toEqual(['Beta', 'Alpha'])
	})

	/* Unfiled is pinned to the top and never carries a slot. Its label is the
	   empty string, which sorts before every other label, so it stays first
	   among the slotless - but a level where everything else is placed must
	   not push it below them. */
	it('keeps the unfiled category first however the rest is arranged', () => {
		const level = [node('Alpha'), node('', ''), node('Zulu')]
		const names = orderedLevel(level, ['Alpha', 'Zulu']).map((n) => n.name)
		expect(names).toEqual(['', 'Alpha', 'Zulu'])
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- categoryOrder`
Expected: FAIL — cannot resolve `src/categoryOrder.js`.

- [ ] **Step 3: Write `src/categoryOrder.js`** with `SMART_PREFIX`, `orderKey` and `orderedLevel` as the Interfaces block gives them.

`orderedLevel` returns a new array and does not mutate its argument. Build an index map from `order` once rather than calling `indexOf` per node.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test -- categoryOrder`
Expected: PASS.

- [ ] **Step 5: Thread the order through `categoryTree.js`**

`buildCategoryTree(categories, order = [])`: replace the body of the local `sort` helper (:83-86) so each level is reordered with `orderedLevel(level, order)` instead of `level.sort(...localeCompare...)`, recursing as it does now. `withSmartCategories(categories, smartCategories, countFor, order = [])`: pass `order` through to `buildCategoryTree`, and replace the `touched` re-sort at :339 with `orderedLevel`.

Both parameters default to `[]`, which reproduces today's name-sorted behaviour exactly — every existing caller and every existing test in `src/tests/categoryTree.spec.js` keeps passing unchanged.

- [ ] **Step 6: Run the whole unit suite**

Run: `npm run test`
Expected: PASS, 593+ tests. Any failure in `categoryTree.spec.js` means the default-`[]` path changed behaviour; fix that rather than the test.

- [ ] **Step 7: Commit**

```bash
git add src/categoryOrder.js src/tests/categoryOrder.spec.js src/categoryTree.js
git commit -m "feat(categories): order a level by an arrangement rather than by name"
```

---

### Task 2: Recording a group, and moving within it

**Files:**
- Modify: `src/categoryOrder.js`
- Modify: `src/tests/categoryOrder.spec.js`

**Interfaces:**
- Consumes: `orderKey`, `orderedLevel` from Task 1.
- Produces:
  - `withKeyAt(order: string[], groupKeys: string[], key: string, index: number) => string[]` — `groupKeys` is the destination group's current visible sequence **including** `key`; the result records that whole group with `key` at `index`, keeps keys belonging to other groups where they were, and contains no key twice.

One function, not three. Recording a group and inserting at the top are the same operation with a different index — a create is `index: 0` — and a second name for it would be sugar nothing needs. It returns a new array and never mutates.

- [ ] **Step 1: Write the failing tests**

```js
describe('withKeyAt', () => {
	it('records a group that had no slots at all', () => {
		expect(withKeyAt([], ['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B'])
	})

	it('leaves keys from other groups where they were', () => {
		const order = ['Other/One', 'B', 'Other/Two', 'A']
		const result = withKeyAt(order, ['A', 'B'], 'A', 0)
		expect(result.filter((k) => k.startsWith('Other/'))).toEqual(['Other/One', 'Other/Two'])
		expect(result.filter((k) => !k.startsWith('Other/'))).toEqual(['A', 'B'])
	})

	it('moves a key that was already placed', () => {
		expect(withKeyAt(['A', 'B', 'C'], ['A', 'B', 'C'], 'A', 2)).toEqual(['B', 'C', 'A'])
	})

	it('puts a newly created category first in its group', () => {
		expect(withKeyAt(['A', 'B'], ['New', 'A', 'B'], 'New', 0)).toEqual(['New', 'A', 'B'])
	})

	/* A key can already sit in the order under another group's run - a
	   reparented category keeps its key and changes group. Emitting the group
	   and leaving the stale copy behind would list it twice, and the index map
	   in orderedLevel would then disagree with itself. */
	it('never lists a key twice', () => {
		const result = withKeyAt(['Moved', 'A', 'B'], ['A', 'Moved', 'B'], 'Moved', 1)
		expect(result).toEqual([...new Set(result)])
		expect(result.filter((k) => k === 'Moved')).toHaveLength(1)
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- categoryOrder`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement the three functions**

The shape that makes "leaves keys from other groups where they were" work: walk `order` once, and wherever a key belonging to this group appears, emit the next key from the desired sequence instead. Append any of the group's keys that `order` had no position for, and drop any later repeat of a key already emitted.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test -- categoryOrder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/categoryOrder.js src/tests/categoryOrder.spec.js
git commit -m "feat(categories): record a whole group when one of it is arranged"
```

---

### Task 3: Following renames and deletes

**Files:**
- Modify: `src/categoryOrder.js`
- Modify: `src/tests/categoryOrder.spec.js`

**Interfaces:**
- Produces:
  - `rekeyOnRename(order: string[], oldPath: string, newPath: string) => string[] | null` — every key equal to `oldPath` or starting `oldPath + '/'` is rewritten onto `newPath`. `null` when nothing matched, matching `reparentOnRename`'s contract in `src/smartCategories.js`.
  - `pruneOnDelete(order: string[], path: string) => string[] | null` — those same keys are removed. `null` when nothing matched.

Smart keys carry an id, not a path, so neither function touches them. A smart category lifted to its grandparent by `reparentOnDelete` is re-slotted by the caller in Task 6, not here.

- [ ] **Step 1: Write the failing tests**

```js
describe('rekeyOnRename', () => {
	it('rewrites the category and everything beneath it', () => {
		const order = ['Clients', 'Clients/A', 'Clients/A/Deep', 'Other']
		expect(rekeyOnRename(order, 'Clients', 'Archive/Clients'))
			.toEqual(['Archive/Clients', 'Archive/Clients/A', 'Archive/Clients/A/Deep', 'Other'])
	})
	it('does not rewrite a category that merely starts with the same letters', () => {
		expect(rekeyOnRename(['ClientsOld'], 'Clients', 'Archive')).toBeNull()
	})
	it('leaves smart keys alone', () => {
		expect(rekeyOnRename(['smart:abc'], 'Clients', 'Archive')).toBeNull()
	})
})

describe('pruneOnDelete', () => {
	it('removes the category and everything beneath it', () => {
		expect(pruneOnDelete(['A', 'A/B', 'A/B/C', 'Z'], 'A')).toEqual(['Z'])
	})
	it('answers null when the category had no slot', () => {
		expect(pruneOnDelete(['Z'], 'A')).toBeNull()
	})
	it('leaves smart keys alone', () => {
		expect(pruneOnDelete(['smart:abc'], 'smart')).toBeNull()
	})
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test -- categoryOrder`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Implement both.** `isWithin` in `src/smartCategories.js:27` is the predicate to mirror; a smart key can never satisfy it because it carries the prefix.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test -- categoryOrder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/categoryOrder.js src/tests/categoryOrder.spec.js
git commit -m "feat(categories): carry the arrangement through renames and deletes"
```

---

### Task 4: The setting

**Files:**
- Modify: `lib/Service/SettingsService.php` (beside `collapsedCategories` at :100)
- Modify: `playwright/e2e/category-order.spec.ts` — **create** this file

**Interfaces:**
- Produces: the settings key `categoryOrder`, default `[]`, readable and writable through the routes that already serve `collapsedCategories`.

- [ ] **Step 1: Write the failing e2e test** in `playwright/e2e/category-order.spec.ts`

Two tests, both driving the settings route directly, modelled on `clearStoredCategory` in `playwright/e2e/category-tree.spec.ts:168` (basic auth, `OCS-APIRequest: true`, a request context with no session cookie):

```ts
test('stores and returns a category order', async ({ request }) => {
	await putSettings(request, { categoryOrder: ['Beta', 'Alpha'] })
	expect(await getSettings(request)).toMatchObject({ categoryOrder: ['Beta', 'Alpha'] })
})

/* Review Focus 3: the cap. The first 1000 keys survive in order; the rest
   are dropped, which surfaces those categories as slotless rather than
   scrambling the arrangement. */
test('keeps the first thousand keys and drops the rest', async ({ request }) => {
	const keys = Array.from({ length: 1200 }, (_, i) => `C${i}`)
	await putSettings(request, { categoryOrder: keys })
	const stored = (await getSettings(request)).categoryOrder
	expect(stored).toHaveLength(1000)
	expect(stored[0]).toBe('C0')
	expect(stored[999]).toBe('C999')
})
```

Restore the setting to `[]` in an `afterEach`, the way `category-tree.spec.ts` resets the stored category.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: FAIL — `categoryOrder` is absent from the settings payload.

- [ ] **Step 3: Declare `categoryOrder` in `SettingsService::$attrs`**

Copy the `collapsedCategories` entry at :100 and change the cap from its count of 1000 to the same 1000, each key `mb_substr(..., 0, 4096)`; reject non-strings and the empty string; `array_values(array_unique(...))`. Truncation keeps the **first** 1000, which `break` already does.

- [ ] **Step 4: Reload PHP and run them again**

Run: `docker exec nextcloud-e2e-test-server_NextCloud-Notes apachectl -k graceful && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: PASS. Without the reload the route still answers from opcache and the test fails for the wrong reason.

- [ ] **Step 5: Commit**

```bash
git add lib/Service/SettingsService.php playwright/e2e/category-order.spec.ts
git commit -m "feat(categories): store the arrangement as a user setting"
```

---

### Task 5: Dropping into a slot

**Files:**
- Modify: `src/components/CategoriesList.vue` — `categoryDropSide` (:606), `onCategoryDragOver` (:739), `onCategoryDrop` (:796 area), `moveCategoryBeside` (:620), `moveCategory` (:631)
- Modify: `playwright/e2e/category-tree.spec.ts` — `moves a category to the top level when dropped on a top-level row edge` and `draws a line on the row a category would land beside` assert name-sorted behaviour and change here
- Modify: `playwright/e2e/category-order.spec.ts`

**Interfaces:**
- Consumes: `withKeyAt`, `orderKey` (Tasks 1-2); `setSettings` from `src/NotesService.js`.
- Produces: a drop that writes `categoryOrder`, and a reorder-within-parent path that performs no rename.

- [ ] **Step 1: Write the failing e2e tests** in `playwright/e2e/category-order.spec.ts`

```ts
test('drops a category into the slot it was aimed at', async ({ page }) => {
	// Three top-level categories, dragged into a deliberately non-alphabetical order.
	await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
	await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Mike'])
	await page.reload()
	await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Mike'])
})

test('reorders among siblings without moving the folder', async ({ page, request }) => {
	// A pure reorder is a settings write and nothing else: the note's path is unchanged.
	const before = await noteCategory(request, noteId)
	await dragCategoryBeside(page, 'Mike', 'Alpha', 'before')
	await expect.poll(() => topLevelOrder(page)).toEqual(['Mike', 'Alpha', 'Zulu'])
	expect(await noteCategory(request, noteId)).toBe(before)
})

/* Review Focus 4: a drop into the dragged category's own subtree. */
test('refuses a drop inside the dragged category and writes nothing', async ({ page, request }) => {
	const before = await getSettings(request)
	await dragCategoryOnto(page, 'Alpha', 'Alpha/Child')
	await expect.poll(() => topLevelOrder(page)).toEqual(['Alpha', 'Mike', 'Zulu'])
	expect(await getSettings(request)).toEqual(before)
})
```

`topLevelOrder(page)` reads the rendered top-level rows in document order — the helper to write, alongside `dragCategoryBeside` adapted from `category-tree.spec.ts:102` to take an explicit `'before' | 'after'`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: FAIL — the dropped category lands in name order, not the aimed slot.

- [ ] **Step 3: Allow a reorder among siblings**

`categorySiblingTarget` (`src/categoryTree.js:216`) returns `null` when the move would leave a category where it already is, which is what refuses a same-parent reorder before a line is drawn. The drop handler must now treat "same parent" as valid and settings-only. Keep `categoryDropTarget`'s refusal of a drop into the dragged category's own subtree exactly as it is.

- [ ] **Step 4: Write the order on drop**

A slot drop computes the destination group's visible keys with `orderKey`, finds the index the line sat at, and calls `withKeyAt`. A same-parent drop then calls `setSettings({ categoryOrder })` alone. A reparenting drop awaits `renameCategoryRequest` first and, on success, sends `categoryOrder` **in the same `setSettings` call** that `onRenameCategory` already makes for `smartCategories` (:667).

Send only the keys being changed. `SettingsService::set` (:320-327) loads the stored value of every attribute the request omits, so a partial write merges server-side and two devices changing *different* settings do not clobber each other. Sending a whole settings object rebuilt from a stale local copy would throw that away.

- [ ] **Step 5: Record the slot when a smart category is dragged**

`onCategoryDrop` has a smart branch of its own (:787-801) that calls `moveSmart(dragged, parent)` to change a smart category's parent, using the same `categoryDropSide`. A smart category dropped into a slot must record its key — `SMART_PREFIX + id` — the same way a folder category does, in the same `setSettings` call `moveSmart` already makes. Without this, smart categories are orderable in the tree and un-droppable in practice, which is half a feature.

Add the Review Focus 5 test for it:

```ts
test('keeps a smart category where it was dropped', async ({ page }) => {
	await dragSmartBeside(page, smartName, 'Alpha', 'before')
	await page.reload()
	await expect.poll(() => topLevelOrder(page)).toEqual([smartName, 'Alpha', 'Mike', 'Zulu'])
})
```

- [ ] **Step 6: Run them and watch them pass**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: PASS.

- [ ] **Step 7: Update the two tests in `category-tree.spec.ts` that assert name-sorted placement**

`moves a category to the top level when dropped on a top-level row edge` keeps its subject — the category still reaches the top level — but may now assert its slot. `draws a line on the row a category would land beside` is about the affordance and belongs to Task 8; leave it until then.

- [ ] **Step 8: Run both specs**

Run: `npx playwright test playwright/e2e/category-order.spec.ts playwright/e2e/category-tree.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/CategoriesList.vue playwright/e2e/category-order.spec.ts playwright/e2e/category-tree.spec.ts
git commit -m "feat(categories): drop a category into the slot it was aimed at"
```

---

### Task 6: Create, rename and delete keep the arrangement

**Files:**
- Modify: `src/components/CategoriesList.vue` — `onCreateCategory` (:528), `onRenameCategory` (:660), `onDeleteCategory` (:690)
- Modify: `playwright/e2e/category-order.spec.ts`

**Interfaces:**
- Consumes: `withKeyAt`, `rekeyOnRename`, `pruneOnDelete` (Tasks 2-3).

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('puts a new category at the top of its group', async ({ page }) => {
	await createCategory(page, 'Newest')
	await expect.poll(() => topLevelOrder(page)).toEqual(['Newest', 'Alpha', 'Mike', 'Zulu'])
	await page.reload()
	await expect.poll(() => topLevelOrder(page)).toEqual(['Newest', 'Alpha', 'Mike', 'Zulu'])
})

test('keeps the arrangement when a category is renamed', async ({ page }) => {
	await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
	await renameCategory(page, 'Zulu', 'Renamed')
	await page.reload()
	await expect.poll(() => topLevelOrder(page)).toEqual(['Renamed', 'Alpha', 'Mike'])
})

test('keeps a subtree in its own order when the parent moves', async ({ page }) => {
	// Alpha holds Three, One, Two in that arranged order; moving Alpha under
	// Mike must not disturb them.
	await dragCategoryOnto(page, 'Alpha', 'Mike')
	await page.reload()
	await expect.poll(() => childrenOrder(page, 'Alpha')).toEqual(['Three', 'One', 'Two'])
})

/* The inline rename field reparents when a slash is typed into it, which moves
   a key into a group where its old index means nothing. */
test('re-slots a category renamed into another group', async ({ page }) => {
	await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
	await renameCategory(page, 'Zulu', 'Mike/Zulu')
	await page.reload()
	await expect.poll(() => childrenOrder(page, 'Mike')).toEqual(['Zulu', 'Existing'])
})

test('drops the slot of a category that is deleted', async ({ page, request }) => {
	await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
	await deleteCategory(page, 'Zulu')
	expect((await getSettings(request)).categoryOrder).not.toContain('Zulu')
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: FAIL — a new category appears in name order; a rename loses the slot.

- [ ] **Step 3: Wire the three handlers**

`onCreateCategory` records the new key at the top of its group with `withKeyAt(..., 0)`, in the same `setSettings` it already makes, after `createCategoryRequest` returns and under the server's returned name. `onRenameCategory` adds `rekeyOnRename`'s result to the `setSettings` it already sends for `smartCategories`. When the rename also changes the category's parent — typing `Mike/Zulu` over `Zulu` — rekeying alone leaves the key carrying an index that means nothing in its new group, so that case re-slots it at the top with `withKeyAt(..., 0)`. The two are distinguished by whether `dirname` of the old and new paths differ. `onDeleteCategory` adds `pruneOnDelete`'s result to the `setSettings` it already sends for `reparentOnDelete` — and because `reparentOnDelete` *lifts* a smart category to the grandparent rather than removing it, that smart key is re-slotted at the top of its new group with `withKeyAt(..., 0)`.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CategoriesList.vue playwright/e2e/category-order.spec.ts
git commit -m "feat(categories): keep the arrangement through create, rename and delete"
```

---

### Task 7: Where the app opens

**Files:**
- Modify: `src/App.vue` (:392, :443)
- Modify: `src/components/CategoriesList.vue` (:376, :597)
- Modify: `src/categoryTree.js` — delete `landingCategory` (:235-248)
- Modify: `src/tests/categoryTree.spec.js` — delete its `landingCategory` tests
- Modify: `src/components/NotesView.vue` — `isFirstRun`
- Modify: `playwright/e2e/category-order.spec.ts`

**Interfaces:**
- Produces: nothing new. `landingCategory` is removed from `categoryTree.js`'s exports.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('opens on the unfiled category when nothing was last viewed', async ({ page, request }) => {
	await putSettings(request, { lastViewedCategory: null })
	await page.goto('/index.php/apps/notes/')
	await expectNavigationItemActive(page, 'Unfiled')
})

test('still welcomes a first run that lands on unfiled', async ({ page, request }) => {
	await deleteAllNotesVia()
	await putSettings(request, { lastViewedCategory: null })
	await page.goto('/index.php/apps/notes/')
	await expect(page.getByText('Write down your thoughts without any distractions.')).toBeVisible()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: FAIL — the app opens on the first category by name, and the first run shows "No notes in this category".

- [ ] **Step 3: Replace the fallback and delete `landingCategory`**

All four call sites fall back to the unfiled category — the empty string — instead of calling `landingCategory`. Delete the function and its tests.

- [ ] **Step 4: Make a first run mean no notes anywhere**

`isFirstRun` in `src/components/NotesView.vue` currently reads `store.notes.numNotes() === 0 && this.category === null`. Drop the category condition.

- [ ] **Step 5: Run them and watch them pass**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the unit suite and the specs that cover landing and the welcome**

Run: `npm run test && npx playwright test playwright/e2e/category-actions.spec.ts playwright/e2e/category-selection.spec.ts playwright/e2e/mobile-layout.spec.ts`
Expected: PASS. `mobile-layout.spec.ts` holds `offers a way to make the first note`, which the `isFirstRun` change can break.

- [ ] **Step 7: Commit**

```bash
git add src/App.vue src/components/CategoriesList.vue src/components/NotesView.vue src/categoryTree.js src/tests/categoryTree.spec.js playwright/e2e/category-order.spec.ts
git commit -m "feat(categories): open where you left off, or on unfiled"
```

---

### Task 8: The drop affordance

**Files:**
- Modify: `src/components/CategoriesList.vue` — `categoryDropSide` (:606)
- Modify: `src/components/CategoryTreeItem.vue` — the `drop-over` / `drop-before` / `drop-after` classes (:17-20) and their styles
- Modify: `src/components/SmartCategoryTreeItem.vue` — `onDragOver` / `onDrop`
- Modify: `playwright/e2e/category-tree.spec.ts` — `draws a line on the row a category would land beside`
- Modify: `playwright/e2e/category-order.spec.ts`

**Interfaces:**
- Consumes: the drop paths from Task 5.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('shows a line for a slot and a shaded group for a nest, never both', async ({ page }) => {
	await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before', false)
	expect(await dropMarks(page)).toEqual({ line: 'Alpha', group: null })

	await dragCategoryOnto(page, 'Zulu', 'Alpha', false)
	expect(await dropMarks(page)).toEqual({ line: null, group: 'Alpha' })
})

test('offers a slot above and below a smart category', async ({ page }) => {
	await dragCategoryBeside(page, 'Zulu', smartName, 'before')
	await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', smartName, 'Alpha', 'Mike'])
})

test('still refuses a note dropped on a smart category', async ({ page }) => {
	const before = await noteCategory(request, noteId)
	await noteRow(page, noteId).dragTo(smartRow(page, smartName))
	expect(await noteCategory(request, noteId)).toBe(before)
})
```

`dropMarks(page)` returns which row carries the line and which carries the group shading, reading the DOM the way `highlightedCategories` at `category-tree.spec.ts:243` does.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: FAIL — a smart row refuses every drop, so the slot beside one is unreachable.

- [ ] **Step 3: Rebalance the hit zones in `categoryDropSide`**

Today: `< 0.25` before, `> 0.75` after, else into — about 11px of edge on a 44px row, which is why the line flickers. Choose a split where neither target is harder to hit than the other, and say in a comment why that split. A smart row has no children, so the whole of it is slot.

`categoryDropSide` is shared: the smart-drag branch of `onCategoryDrop` (:793) calls it too, so rebalancing changes where a dragged *smart* category lands as well. The tests from Task 5 cover that; run them here rather than discovering it later.

- [ ] **Step 4: Make the group shading cover the row and its children**

The nest affordance shades the destination row **and its children**, so it reads as "lands in this group" rather than "lands on this row". The line and the shading are never both present.

- [ ] **Step 5: Let a smart row take a category drop**

`SmartCategoryTreeItem.vue` refuses every drop today by setting `dropEffect = 'none'` and never calling `preventDefault`. It must now accept a **category** drag as a slot while still refusing a **note** drag — that refusal exists because a swallowed note drop bubbles to the folder row the smart row sits inside and files the note where the pointer never was. `isCategoryDrag` in `CategoriesList.vue` is the discriminator.

- [ ] **Step 6: Run them and watch them pass**

Run: `npm run build && npx playwright test playwright/e2e/category-order.spec.ts`
Expected: PASS.

- [ ] **Step 7: Update `draws a line on the row a category would land beside`**

Its subject survives — a line still marks a slot — but the zone it aims at has moved.

- [ ] **Step 8: Run the whole suite**

Run: `npm run test && npm run build && npx playwright test`
Expected: PASS, 0 failed.

- [ ] **Step 9: Commit**

```bash
git add src/components/CategoriesList.vue src/components/CategoryTreeItem.vue src/components/SmartCategoryTreeItem.vue playwright/e2e/category-order.spec.ts playwright/e2e/category-tree.spec.ts
git commit -m "fix(categories): say where a dragged category will land"
```
