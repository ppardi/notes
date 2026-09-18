/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page, TestInfo } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'

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

	test('lets a category in the URL win over the stored one', async ({ page }) => {
		await openNotesApp(page)
		const stored = storedSelection(page)
		await navigationLink(page, work).click()
		await stored

		await openNotesApp(page, `?category=${encodeURIComponent(personal)}`)

		await expect(noteRow(page, personalNote)).toBeVisible()
		await expect(noteRow(page, workNote)).toBeHidden()
	})

	test('drops the parameter for the all-notes selection', async ({ page }) => {
		await openNotesApp(page)
		await navigationLink(page, work).click()
		await expect(page).toHaveURL(categoryInUrl(work))

		await navigationLink(page, 'All notes').click()

		await expect(page).not.toHaveURL(/[?&]category=/)
		await expect(noteRow(page, workNote)).toBeVisible()
		await expect(noteRow(page, personalNote)).toBeVisible()
	})
})
