/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNote, createNoteViaApi, currentNoteId, newNoteButton, noteRow, uniqueTitle, waitForNoteRoute } from '../support/note.ts'

function appNavigation(page: Page): Locator {
	return page.getByRole('navigation').filter({
		has: addCategoryButton(page),
	}).first()
}

function addCategoryButton(page: Page): Locator {
	return page.getByRole('button', { name: 'Add category', exact: true })
}

/**
 * Start a new category from the Categories heading.
 *
 * The heading's plus opens a menu now that there is more than one kind of
 * category to make, so this is two clicks rather than one.
 *
 * @param page The page under test
 */
async function startNewCategory(page: Page): Promise<void> {
	await addCategoryButton(page).click()
	await page.getByRole('menuitem', { name: 'New category', exact: true }).click()
}

function notesSearchField(page: Page): Locator {
	return page.getByRole('textbox', { name: 'Search for notes', exact: true })
}

function notesViewNewNoteButton(page: Page): Locator {
	// The search field lives in the sidebar, so it is no longer a way in here.
	return page.locator('.content-list__actions')
		.getByRole('button', { name: 'New note', exact: true })
}

function navigationRow(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
		.locator('xpath=ancestor::li[1]')
		.first()
}

function navigationLink(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
}

async function expectNavigationItemActive(page: Page, name: string): Promise<void> {
	await expect(navigationLink(page, name)).toHaveAttribute('aria-current', 'page')
}

async function openNotesApp(page: Page): Promise<void> {
	await page.goto('/index.php/apps/notes/')
	await expect(addCategoryButton(page)).toBeVisible()
	await expect(newNoteButton(page)).toHaveCount(1)
	await expect(newNoteButton(page)).toBeVisible()
}

async function createCategory(page: Page, name: string): Promise<void> {
	const navigation = appNavigation(page)

	await startNewCategory(page)

	const input = navigation.getByPlaceholder('New category', { exact: true })
	await expect(input).toBeVisible()
	await input.fill(name)
	await input.press('Enter')

	await expect(navigationRow(page, name)).toBeVisible()
	await expectNavigationItemActive(page, name)
}

async function ensureNotesView(page: Page): Promise<void> {
	if (await notesSearchField(page).isVisible()) {
		return
	}

	const previousNoteId = currentNoteId(page)
	await newNoteButton(page).click()
	await waitForNoteRoute(page, previousNoteId)
	await expect(notesSearchField(page)).toBeVisible()
}

async function createNoteInSelectedCategory(page: Page, category: string): Promise<number> {
	await ensureNotesView(page)

	const previousNoteId = currentNoteId(page)
	await notesViewNewNoteButton(page).click()

	const noteId = await waitForNoteRoute(page, previousNoteId)
	await expect(navigationRow(page, category).locator('.app-navigation-entry__counter-wrapper')).toContainText('1')

	return noteId
}

async function fileNoteViaApi(page: Page, noteId: number, category: string): Promise<void> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
	const response = await page.request.put(`/index.php/apps/notes/api/v1/notes/${noteId}`, {
		headers,
		data: { category },
	})
	expect(response.ok(), `filing note ${noteId} in "${category}": HTTP ${response.status()}`).toBeTruthy()
}

/* The selected category is remembered server-side, so leaving one selected
   would change where unrelated specs start. A category that holds no notes
   now survives a reload, and landing on one opens the welcome screen rather
   than a notes list. The request fixture carries no session cookie, which the
   settings route needs. */
async function clearStoredCategory(request: APIRequestContext): Promise<void> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = {
		Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
		// Without this the settings route answers 412 and the reset does nothing.
		'OCS-APIRequest': 'true',
	}
	const response = await request.put('/index.php/apps/notes/settings', {
		headers,
		data: { lastViewedCategory: 'all', collapsedCategories: [] },
	})
	expect(response.ok(), 'resetting the stored navigation state').toBeTruthy()
}

async function openCategoryActions(page: Page, category: string): Promise<void> {
	const row = navigationRow(page, category)

	await expect(row).toBeVisible()
	await row.hover()

	const actionsButton = row.getByRole('button', { name: 'Actions', exact: true })
	await expect(actionsButton).toBeVisible()
	await actionsButton.click()
}

test.describe('Category actions', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await openNotesApp(page)
	})

	test.afterEach(async ({ request }) => {
		await clearStoredCategory(request)
	})

	test('brings back a category that holds no notes', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('empty', testInfo)

		await createCategory(page, category)

		/* Nothing has been filed in it, so nothing but a folder on the server can
		   bring it back. */
		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expect(navigationRow(page, category)).toBeVisible()
	})

	test('shows a new category under the name a folder can hold', async ({ page }, testInfo: TestInfo) => {
		/* A colon cannot go in a folder name on every platform, so the server
		   drops it. The sidebar has to show what was made, not what was typed. */
		const typed = `${uniqueTitle('colon', testInfo)}: B`
		const stored = typed.replace(':', '')

		const navigation = appNavigation(page)
		await startNewCategory(page)
		const input = navigation.getByPlaceholder('New category', { exact: true })
		await expect(input).toBeVisible()
		await input.fill(typed)
		await input.press('Enter')

		await expect(navigationRow(page, stored)).toBeVisible()
		await expect(navigationRow(page, typed)).toHaveCount(0)
		await expectNavigationItemActive(page, stored)

		// And it is the stored name that comes back.
		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expect(navigationRow(page, stored)).toBeVisible()
	})

	test('shows the note list, not the welcome screen, in a category with no notes', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('bare', testInfo)
		await createCategory(page, category)

		/* Reloaded, because landing on an empty category is what opened the
		   welcome screen: the route has no note to show. */
		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expectNavigationItemActive(page, category)

		/* A category somebody just made is not a first run of the app. The list
		   and its own New note button stay in reach, and the pane beside them
		   says why it is empty rather than offering the app store. */
		await expect(notesViewNewNoteButton(page)).toBeVisible()
		await expect(page.getByText('No notes in this category')).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toHaveCount(0)
		await expect(page.getByText('Write down your thoughts without any distractions.')).toHaveCount(0)
	})

	test('brings back a nested category that holds no notes', async ({ page }, testInfo: TestInfo) => {
		const parent = uniqueTitle('outer', testInfo)
		const child = uniqueTitle('inner', testInfo)

		await createCategory(page, parent)
		await openCategoryActions(page, parent)
		await page.getByRole('menuitem', { name: 'New subcategory', exact: true }).click()
		const input = appNavigation(page).getByPlaceholder('New category', { exact: true })
		await expect(input).toBeVisible()
		await input.fill(child)
		await input.press('Enter')
		await expect(navigationRow(page, child)).toBeVisible()

		/* Nothing is filed in either, so only the folders can bring them back -
		   which means the server has to report the nested one and not just its
		   parent. */
		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expect(navigationRow(page, parent)).toBeVisible()
		await expect(navigationRow(page, child)).toBeVisible()
	})

	test('keeps a category whose last note is filed elsewhere', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('emptied', testInfo)
		await createCategory(page, category)

		/* Through the API, so the note is never open in the editor: a note held
		   open is locked, and the move out would be refused rather than tested. */
		const noteId = await createNoteViaApi(page, category, 'Passing through')

		// Going empty is no reason to destroy a category somebody made on purpose.
		await fileNoteViaApi(page, noteId, '')

		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expect(navigationRow(page, category)).toBeVisible()
	})

	test('renames a category from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('rename', testInfo)
		const renamedCategory = `${category} renamed`
		const noteId = await (async () => {
			await createCategory(page, category)
			return createNoteInSelectedCategory(page, category)
		})()

		await openCategoryActions(page, category)
		await page.getByRole('menuitem', { name: 'Rename category', exact: true }).click()

		const renameInput = appNavigation(page).getByPlaceholder(category, { exact: true })
		await expect(renameInput).toBeVisible()
		await renameInput.fill(renamedCategory)
		await renameInput.press('Enter')

		await expect(navigationRow(page, renamedCategory)).toBeVisible()
		await expectNavigationItemActive(page, renamedCategory)
		await expect(navigationRow(page, renamedCategory).locator('.app-navigation-entry__counter-wrapper')).toContainText('1')
		await expect(navigationRow(page, category)).toHaveCount(0)
		await expect(page).toHaveURL(new RegExp(`/note/${noteId}(\\?.*)?$`))
	})

	test('creates a subcategory from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const parent = uniqueTitle('parent', testInfo)
		const child = uniqueTitle('child', testInfo)

		await createCategory(page, parent)

		await openCategoryActions(page, parent)
		await page.getByRole('menuitem', { name: 'New subcategory', exact: true }).click()

		const input = appNavigation(page).getByPlaceholder('New category', { exact: true })
		await expect(input).toBeVisible()
		await input.fill(child)
		await input.press('Enter')

		// The new row is nested under its parent, not made a sibling of it.
		await expect(navigationRow(page, child)).toBeVisible()
		// .first() because deeper rows carry a children list of their own.
		await expect(navigationRow(page, parent).locator('.app-navigation-entry__children').first())
			.toContainText(child)
		await expectNavigationItemActive(page, child)

		// A note filed here has to come back nested after a reload, which is what
		// shows the category was stored as the path "parent/child" on the server
		// rather than only assembled in the browser.
		await createNoteInSelectedCategory(page, child)
		await page.reload()
		await expect(addCategoryButton(page)).toBeVisible()
		await expect(navigationRow(page, parent).locator('.app-navigation-entry__children').first())
			.toContainText(child)
	})

	test('deletes a category from the actions menu', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('delete', testInfo)
		await createCategory(page, category)
		const noteId = await createNoteInSelectedCategory(page, category)
		const deletedNoteUrl = new RegExp(`/note/${noteId}(\\?.*)?$`)

		await openCategoryActions(page, category)
		await page.getByRole('menuitem', { name: 'Delete category', exact: true }).click()

		const confirmationText = `Delete category "${category}" and its 1 note?`
		await expect(page.getByText(confirmationText, { exact: true })).toBeVisible()

		await page.getByRole('button', { name: 'Delete', exact: true }).click()

		await expect(navigationRow(page, category)).toHaveCount(0)
		await expect(page).not.toHaveURL(deletedNoteUrl)
		await expect(page).not.toHaveURL(new RegExp(`[?&]category=${category}(&|$)`))
	})
})

test.describe('Drag and drop', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await page.goto('/index.php/apps/notes/')
		await expect(addCategoryButton(page)).toBeVisible()
	})

	test('moves a note into a category by dragging it', async ({ page }, testInfo: TestInfo) => {
		const category = uniqueTitle('drag-target', testInfo)
		const title = uniqueTitle('drag-note', testInfo)

		await createCategory(page, category)
		const noteId = await createNote(page, title)

		await noteRow(page, noteId).dragTo(navigationRow(page, category))

		await expect(navigationRow(page, category).locator('.app-navigation-entry__counter-wrapper')).toContainText('1')
		await navigationRow(page, category).getByRole('link').click()
		await expect(noteRow(page, noteId)).toBeVisible()
	})
})
