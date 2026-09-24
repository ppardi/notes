/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, setSmartCategories } from '../support/note.ts'

/* Real category rows are found by their title, the way every other category
   spec finds them. A smart category's title carries its tags instead - a
   tooltip saying what it is looking for is worth more than matching that
   convention - so its rows are found through the class they carry, which also
   keeps a smart category and a real one of the same name apart. */
function categoryLink(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true }).first()
}

function categoryRow(page: Page, name: string): Locator {
	return categoryLink(page, name)
		.locator('xpath=ancestor::div[contains(@class,"app-navigation-entry")][1]')
}

function smartRow(page: Page, name: string): Locator {
	return page.locator('.smart-category-entry')
		.filter({ has: page.getByRole('link', { name, exact: true }) })
		.first()
}

function smartLink(page: Page, name: string): Locator {
	return smartRow(page, name).getByRole('link', { name, exact: true }).first()
}

/**
 * How far a row is indented, which is what says where it sits in the tree.
 *
 * @param locator the row's link
 */
async function indentOf(locator: Locator): Promise<number> {
	const box = await locator.boundingBox()
	return Math.round(box?.x ?? -1)
}

/**
 * Tick a tag in the dialog.
 *
 * The switch hides its real input behind a label that takes the pointer
 * events, so a person ticks it by clicking the label - and so does this.
 *
 * @param dialog the open dialog
 * @param tag the tag to tick
 */
async function chooseTag(dialog: Locator, tag: string): Promise<void> {
	await dialog.getByText(tag, { exact: true }).click()
	await expect(dialog.getByRole('checkbox', { name: tag })).toBeChecked()
}

/**
 * Open a row's own menu.
 *
 * The actions only appear on hover or focus, so the row has to be hovered
 * before its trigger can be clicked.
 *
 * @param row the row, from smartRow()
 */
async function openMenu(row: Locator): Promise<void> {
	await expect(row).toBeVisible()
	await row.hover()
	const actions = row.getByRole('button', { name: 'Actions', exact: true })
	await expect(actions).toBeVisible()
	await actions.click()
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(page.locator('#app-navigation-vue')).toBeVisible()
}

test.describe('Smart categories', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotesVia()
		await setSmartCategories([])
	})

	test('lands somewhere real when the record has gone', async ({ page }) => {
		/* A link kept from before the category was deleted, or a second tab that
		   deleted it. Leaving the list empty with nothing selected reads as a
		   broken app. */
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')

		await page.goto('/index.php/apps/notes/?smart=doesnotexist')

		await expect(page.locator('#app-navigation-vue')).toBeVisible()
		await expect(page).not.toHaveURL(/smart=/)
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
	})

	test('opens like a folder, not like the all-notes list', async ({ page }) => {
		/* Grouping and sort both branch on there being no selected category,
		   and opening a smart category clears it - so without the selection
		   reaching the store, this list comes back under "Today". */
		const work = await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		const personal = await createNoteViaRequest('Personal', 'Rigid Designators', 'Also #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await page.goto('/index.php/apps/notes/?smart=reading')

		await expect(page.getByRole('link', { name: 'Rigid Designators' })).toBeVisible()
		await expect(page.getByText('Today', { exact: true })).toHaveCount(0)

		/* Ordered by where the notes are really filed, so Personal comes before
		   Work however recently either was touched. */
		const order = await page.locator('.notes-list a[href*="/note/"]')
			.evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
		expect(order.findIndex((href) => href.includes(`/note/${personal}`)))
			.toBeLessThan(order.findIndex((href) => href.includes(`/note/${work}`)))
	})

	test('shows the notes a stored category names', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await page.goto('/index.php/apps/notes/?smart=reading')

		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})

	test('shows a row with its count, and opens it when clicked', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Word and Object', 'Also #philosophy')
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)

		await expect(smartLink(page, 'Reading')).toBeVisible()
		await expect(smartRow(page, 'Reading').locator('.app-navigation-entry__counter-wrapper').first())
			.toContainText('2')

		await smartLink(page, 'Reading').click()

		await expect(page).toHaveURL(/smart=reading/)
		await expect(page.getByRole('link', { name: 'Word and Object' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})

	test('sits under its parent, and is painted as current when open', async ({ page }) => {
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
			{ id: 'other', name: 'Other', tags: ['kripke'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)

		/* Indent is what says where a row sits, the same way the category tree
		   specs prove nesting. */
		await expect(smartLink(page, 'Reading')).toBeVisible()
		expect(await indentOf(smartLink(page, 'Reading')))
			.toBeGreaterThan(await indentOf(categoryLink(page, 'Work')))
		expect(await indentOf(smartLink(page, 'Other')))
			.toBe(await indentOf(categoryLink(page, 'Work')))

		await smartLink(page, 'Reading').click()

		/* Class and paint together: the class has sat on an inner element while
		   nothing was painted, and the paint picks up hover from the last
		   click. */
		await page.mouse.move(600, 600)
		const background = (name: string) => smartRow(page, name)
			.locator('.app-navigation-entry').first()
			.evaluate((element) => window.getComputedStyle(element).backgroundColor)
		expect(await background('Reading')).not.toBe(await background('Other'))
	})

	test('refuses a note dropped onto it', async ({ page }) => {
		/* Tags live in the note's text, so filing a note here would mean editing
		   the note body. The drop must also not fall through to the parent
		   category, which would file the note somewhere the pointer never was. */
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
		])

		await openNotesApp(page)
		await categoryLink(page, 'Unfiled').click()

		const note = page.getByRole('link', { name: 'Shopping' })
		await note.dragTo(smartLink(page, 'Reading'))

		// still where it was: neither tagged, nor filed into Work
		await expect(page.getByRole('link', { name: 'Shopping' })).toBeVisible()
		await categoryLink(page, 'Work').click()
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})

	test('makes one from the Categories menu', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Shopping', 'Milk')

		await openNotesApp(page)

		await page.locator('.app-navigation-caption').filter({ hasText: 'Categories' })
			.getByRole('button').first().click()
		await page.getByRole('menuitem', { name: 'New smart category' }).click()

		const dialog = page.getByRole('dialog')
		await expect(dialog).toBeVisible()
		await dialog.getByRole('textbox', { name: 'Name' }).fill('Reading')
		await chooseTag(dialog, 'philosophy')
		await expect(dialog).toContainText('1 note')
		await dialog.getByRole('button', { name: 'Create' }).click()

		await expect(smartLink(page, 'Reading')).toBeVisible()
		await expect(smartRow(page, 'Reading').locator('.app-navigation-entry__counter-wrapper').first())
			.toContainText('1')

		/* Made from what the dialog was showing, so it opens: a row that sat
		   there unlit read as a save that had not taken. */
		await expect(page).toHaveURL(/smart=/)
		await expect(page.getByRole('link', { name: 'Shopping' })).toHaveCount(0)
	})

	test('takes the tags as its name when none is typed', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')

		await openNotesApp(page)

		await page.locator('.app-navigation-caption').filter({ hasText: 'Categories' })
			.getByRole('button').first().click()
		await page.getByRole('menuitem', { name: 'New smart category' }).click()

		const dialog = page.getByRole('dialog')
		await chooseTag(dialog, 'philosophy')
		await dialog.getByRole('button', { name: 'Create' }).click()

		await expect(smartLink(page, '#philosophy')).toBeVisible()
	})

	test('will not create one with no tags', async ({ page }) => {
		await openNotesApp(page)

		await page.locator('.app-navigation-caption').filter({ hasText: 'Categories' })
			.getByRole('button').first().click()
		await page.getByRole('menuitem', { name: 'New smart category' }).click()

		const dialog = page.getByRole('dialog')
		await dialog.getByRole('textbox', { name: 'Name' }).fill('Empty')
		await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
	})

	test('adds a tag to one that already exists', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await createNoteViaRequest('', 'Rigid Designators', 'On #kripke')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await smartLink(page, 'Reading').click()
		await expect(page.getByRole('link', { name: 'Rigid Designators' })).toHaveCount(0)

		await openMenu(smartRow(page, 'Reading'))
		await page.getByRole('menuitem', { name: 'Edit tags' }).click()

		const dialog = page.getByRole('dialog')
		await expect(dialog.getByRole('checkbox', { name: 'philosophy' })).toBeChecked()
		await chooseTag(dialog, 'kripke')
		await dialog.getByRole('button', { name: 'Save' }).click()

		/* The list follows the record, not the URL: the id in the URL has not
		   changed, so a view built from the URL's own tags would still be
		   showing the old ones. */
		await expect(page.getByRole('link', { name: 'Rigid Designators' })).toBeVisible()
		await expect(smartRow(page, 'Reading')
			.locator('.app-navigation-entry__counter-wrapper').first()).toContainText('2')
	})

	test('keeps a tag no note carries any more', async ({ page }) => {
		/* The tag is still part of what the category means. Offering only the
		   tags in use would drop it from the list, and the next save would drop
		   it from the category without anyone saying so. */
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy', 'retired'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await openMenu(smartRow(page, 'Reading'))
		await page.getByRole('menuitem', { name: 'Edit tags' }).click()

		const dialog = page.getByRole('dialog')
		await expect(dialog.getByRole('checkbox', { name: 'retired' })).toBeChecked()
		await dialog.getByRole('button', { name: 'Save' }).click()

		await openMenu(smartRow(page, 'Reading'))
		await page.getByRole('menuitem', { name: 'Edit tags' }).click()
		await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'retired' })).toBeChecked()
	})

	test('renames one without changing what it holds', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await smartLink(page, 'Reading').click()

		await openMenu(smartRow(page, 'Reading'))
		await page.getByRole('menuitem', { name: 'Rename smart category' }).click()
		/* Not scoped to the row: while it is being renamed the row has an
		   input where its link was, so a locator that looks for the link by
		   name no longer finds it. */
		const field = page.locator('.smart-category-entry input[type="text"]').first()
		await field.fill('Philosophy shelf')
		await field.press('Enter')

		await expect(smartLink(page, 'Philosophy shelf')).toBeVisible()
		/* Identity is the id, so the row it renamed is the row that stays open. */
		await expect(page).toHaveURL(/smart=reading/)
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
	})

	test('deletes one and leaves the notes alone', async ({ page }) => {
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await smartLink(page, 'Reading').click()

		await openMenu(smartRow(page, 'Reading'))
		await page.getByRole('menuitem', { name: 'Delete smart category' }).click()

		await expect(page.locator('.smart-category-entry')).toHaveCount(0)
		await expect(page).not.toHaveURL(/smart=/)
		// the note it named is still there, wherever it is filed
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
	})

	test('drags into a category, and back out to the top', async ({ page }) => {
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)

		const topLevel = await indentOf(categoryLink(page, 'Work'))

		await smartLink(page, 'Reading').dragTo(categoryLink(page, 'Work'))
		await expect.poll(() => indentOf(smartLink(page, 'Reading'))).toBeGreaterThan(topLevel)

		/* Placement is filing, not filter: it still holds what it always held.
		   Opened by URL rather than by clicking the row, because where the app
		   lands on load depends on a setting earlier tests leave behind, and
		   from the welcome screen the note list is not rendered at all - for a
		   real category just as much as for a smart one. */
		await page.goto('/index.php/apps/notes/?smart=reading')
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()

		/* And back out. A row's top edge files it at that row's own level rather
		   than inside it - the same rule a real category follows, and the only
		   way back to the top. */
		await smartLink(page, 'Reading').dragTo(categoryLink(page, 'Work'), {
			targetPosition: { x: 20, y: 2 },
		})
		await expect.poll(() => indentOf(smartLink(page, 'Reading'))).toBe(topLevel)
	})

	test('follows the category it sits in when that is renamed', async ({ page }) => {
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
		])

		await openNotesApp(page)

		await openMenu(categoryRow(page, 'Work'))
		await page.getByRole('menuitem', { name: 'Rename category' }).click()
		/* The edit field carries the current name as its placeholder, which is
		   how the category specs find it - the row's own locator stops
		   matching while the link is replaced by the input. */
		const field = page.getByPlaceholder('Work', { exact: true })
		await field.fill('Job')
		await field.press('Enter')

		await expect(smartLink(page, 'Reading')).toBeVisible()
		expect(await indentOf(smartLink(page, 'Reading')))
			.toBeGreaterThan(await indentOf(categoryLink(page, 'Job')))

		/* Stored, not just redrawn: a reload reads it back from the settings. */
		await page.reload()
		expect(await indentOf(smartLink(page, 'Reading')))
			.toBeGreaterThan(await indentOf(categoryLink(page, 'Job')))
	})

	test('moves up rather than going with a deleted category', async ({ page }) => {
		await createNoteViaRequest('', 'Shopping', 'Milk')
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: 'Work' },
		])

		await openNotesApp(page)

		await openMenu(categoryRow(page, 'Work'))
		await page.getByRole('menuitem', { name: 'Delete category' }).click()
		await page.getByRole('button', { name: 'Delete' }).click()

		/* It holds no notes of its own, so there is nothing about deleting a
		   folder that should destroy it. */
		await expect(smartLink(page, 'Reading')).toBeVisible()
		await page.reload()
		await expect(smartLink(page, 'Reading')).toBeVisible()

		/* And the record itself was corrected, not merely rendered around: a
		   category that still remembered the deleted path would jump back
		   under a new category of the same name. Drawing an orphan at the top
		   level would hide that, so this is what proves the stored parent
		   moved. */
		await createNoteViaRequest('Work', 'Word and Object', 'Quine')
		await page.reload()
		await expect(categoryLink(page, 'Work')).toBeVisible()
		expect(await indentOf(smartLink(page, 'Reading')))
			.toBe(await indentOf(categoryLink(page, 'Work')))
	})

	test('leaves the tag rows dark while a smart category is driving', async ({ page }) => {
		/* Its tags really are the selection, so the tag list would light them
		   too - three rows lit from one click, which reads as "why is
		   everything highlighted". The smart category is what was chosen. */
		await createNoteViaRequest('', 'Naming and Necessity', 'On #philosophy')
		await setSmartCategories([
			{ id: 'reading', name: 'Reading', tags: ['philosophy'], mode: 'any', parent: '' },
		])

		await openNotesApp(page)
		await page.goto('/index.php/apps/notes/?smart=reading')
		await expect(smartLink(page, 'Reading')).toBeVisible()

		await page.mouse.move(600, 600)
		const tagRow = page.locator('.tag-entry')
			.filter({ has: page.getByRole('link', { name: 'philosophy', exact: true }) }).first()
		const paint = (row: Locator) => row.locator('.app-navigation-entry').first()
			.evaluate((el) => window.getComputedStyle(el).backgroundColor)

		/* The smart row is painted as current; the tag it holds is not. */
		expect(await paint(smartRow(page, 'Reading'))).not.toBe(await paint(tagRow))

		/* Chosen by hand, the same tag does light up - the rule is about which
		   thing was selected, not about hiding the tag list. */
		await page.getByRole('link', { name: 'philosophy', exact: true }).click()
		await expect(page).toHaveURL(/tags=philosophy/)
		await page.mouse.move(600, 600)
		expect(await paint(tagRow)).not.toBe(await paint(smartRow(page, 'Reading')))
	})

	test('leaves the welcome screen when a selection has something to show', async ({ page }) => {
		/* The note list lives on the note route, so a selection made while the
		   welcome screen is up changed the URL and nothing else - no list, no
		   note, sidebar looking dead. */
		await createNoteViaRequest('Work', 'Naming and Necessity', 'On #philosophy')

		await page.goto('/index.php/apps/notes/welcome')
		await expect(page.locator('#app-navigation-vue')).toBeVisible()
		await expect(page).toHaveURL(/welcome/)
		await expect(page.locator('.notes-list')).toHaveCount(0)

		await page.getByTitle('Work', { exact: true }).first().click()

		await expect(page).not.toHaveURL(/welcome/)
		await expect(page.getByRole('link', { name: 'Naming and Necessity' })).toBeVisible()
	})
})
