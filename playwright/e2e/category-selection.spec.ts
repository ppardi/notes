/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'
import { NoteEditor } from '../support/sections/NoteEditor.ts'

async function createNoteViaApi(page: Page, category: string, title: string): Promise<number> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }

	const response = await page.request.post('/index.php/apps/notes/api/v1/notes', {
		headers,
		data: { category, content: `# ${title}` },
	})
	expect(response.ok(), `creating note in category "${category}"`).toBeTruthy()

	const note = await response.json() as { id: number }
	return note.id
}

function navigationLink(page: Page, name: string): Locator {
	return page.getByRole('link', { name, exact: true })
}

function categoryInUrl(category: string): RegExp {
	return new RegExp(`[?&]category=${category}(&|$)`)
}

async function openNotesApp(page: Page, query = ''): Promise<void> {
	await page.goto(`/index.php/apps/notes/${query}`)
	await expect(newNoteButton(page).first()).toBeVisible()
}

/* The stored selection is written asynchronously, so wait for it before a test
   navigates away and relies on it. Each test uses its own category names, so
   the write is always a change and always happens. */
function storedSelection(page: Page): Promise<unknown> {
	return page.waitForResponse((response) => response.url().includes('/apps/notes/settings') && response.request().method() === 'PUT')
}

/* The selected category is remembered server-side, so leaving one selected
   would change where unrelated specs start. The request fixture carries no
   session cookie, which the settings route needs. */
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

test.describe('Category selection', () => {
	let work: string
	let personal: string
	let workNote: number
	let personalNote: number

	test.beforeEach(async ({ page }, testInfo: TestInfo) => {
		await login(page)
		await deleteAllNotes(page)
		// No spaces: the router encodes them as '+', which complicates URL assertions.
		work = `work-${testInfo.testId}`
		personal = `personal-${testInfo.testId}`
		workNote = await createNoteViaApi(page, work, 'Work note')
		personalNote = await createNoteViaApi(page, personal, 'Personal note')
	})

	test.afterEach(async ({ request }) => {
		await clearStoredCategory(request)
	})

	test('puts the selected category in the URL', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, work).click()

		await expect(page).toHaveURL(categoryInUrl(work))
	})

	test('keeps the selected category across a reload', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, work).click()
		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()

		await page.reload()

		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('keeps the category selected when a note is opened', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, work).click()
		await expect(noteRow(page, workNote)).toBeVisible()

		await page.locator(`a[href$="/note/${workNote}"], a[href*="/note/${workNote}?"]`).first().click()

		await expect(page).toHaveURL(categoryInUrl(work))
		await expect(navigationLink(page, work)).toHaveAttribute('aria-current', 'page')
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('moves between selections with the browser history', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, work).click()
		await expect(noteRow(page, personalNote)).toBeHidden()

		await navigationLink(page, personal).click()
		await expect(noteRow(page, workNote)).toBeHidden()

		await page.goBack()

		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('returns to the last category when the app is opened without a query', async ({ page }) => {
		await openNotesApp(page)
		const stored = storedSelection(page)
		await navigationLink(page, work).click()
		await stored

		await openNotesApp(page)

		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeHidden()
	})

	test('opens the note a link points at, whatever category was stored', async ({ page }) => {
		await openNotesApp(page)
		const stored = storedSelection(page)
		await navigationLink(page, work).click()
		await stored

		/* What the server-wide search, a share or the dashboard links to: the
		   note alone, with nothing in the query to say what the list should
		   show. Restoring the stored category over it used to file the note out
		   of the list, which hid the note and left the link looking broken. */
		await page.goto(`/index.php/apps/notes/note/${personalNote}`)
		await expect(newNoteButton(page).first()).toBeVisible()

		await new NoteEditor(page).expectText('Personal note')
		await expect(page).toHaveURL(new RegExp(`/note/${personalNote}(\\?|$)`))
		// The list follows the note, rather than the note following the list.
		await expect(noteRow(page, personalNote)).toBeVisible()
		await expect(noteRow(page, workNote)).toBeHidden()
	})

	test('lets a category in the URL win over the stored one', async ({ page }) => {
		await openNotesApp(page)
		const stored = storedSelection(page)
		await navigationLink(page, work).click()
		await stored

		await openNotesApp(page, `?category=${encodeURIComponent(personal)}`)

		await expect(noteRow(page, personalNote)).toBeVisible()
		await expect(noteRow(page, workNote)).toBeHidden()
	})
})
