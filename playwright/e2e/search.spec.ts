/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { deleteAllNotes, newNoteButton, noteRow } from '../support/note.ts'

async function createNoteViaApi(page: Page, category: string, title: string, body = ''): Promise<number> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }
	const response = await page.request.post('/index.php/apps/notes/api/v1/notes', {
		headers,
		// The title has to be explicit: given only content, the API files the
		// note as "New note", which no search for its text would ever find.
		data: { category, title, content: `# ${title}\n\n${body}` },
	})
	expect(response.ok(), `creating note in "${category}"`).toBeTruthy()
	return (await response.json() as { id: number }).id
}

/* Selecting a category is remembered server-side, so leaving one selected would
   change where unrelated specs start. */
async function clearStoredCategory(request: APIRequestContext): Promise<void> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const response = await request.put('/index.php/apps/notes/settings', {
		headers: {
			Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
			// Without this the settings route answers 412 and the reset does nothing.
			'OCS-APIRequest': 'true',
		},
		data: { lastViewedCategory: 'all', collapsedCategories: [] },
	})
	expect(response.ok(), 'resetting the stored navigation state').toBeTruthy()
}

function searchBox(page: Page) {
	return page.getByRole('textbox', { name: 'Search for notes' })
}

test.describe('Search', () => {
	let looseReport: number
	let workReport: number
	let nestedReport: number
	let unrelated: number

	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotes(page)
		looseReport = await createNoteViaApi(page, '', 'Loose report')
		workReport = await createNoteViaApi(page, 'Work', 'Work report')
		nestedReport = await createNoteViaApi(page, 'Work/Projects', 'Nested report')
		unrelated = await createNoteViaApi(page, 'Personal', 'Something else')

		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()
	})

	test.afterEach(async ({ request }) => {
		await clearStoredCategory(request)
	})

	test('finds notes in every category while a category is selected', async ({ page }) => {
		await page.getByTitle('Work', { exact: true }).first().click()
		await expect(noteRow(page, looseReport)).toBeHidden()

		await searchBox(page).fill('report')

		await expect(noteRow(page, workReport)).toBeVisible()
		await expect(noteRow(page, looseReport)).toBeVisible()
		await expect(noteRow(page, nestedReport)).toBeVisible()
		await expect(noteRow(page, unrelated)).toBeHidden()
	})

	test('says which category each result is in', async ({ page }) => {
		await page.getByTitle('Work', { exact: true }).first().click()
		await searchBox(page).fill('report')

		await expect(noteRow(page, nestedReport)).toContainText('Work / Projects')
	})

	test('returns to the selected category when the search is cleared', async ({ page }) => {
		await page.getByTitle('Work', { exact: true }).first().click()
		await searchBox(page).fill('report')
		await expect(noteRow(page, looseReport)).toBeVisible()

		await searchBox(page).fill('')

		await expect(noteRow(page, workReport)).toBeVisible()
		await expect(noteRow(page, looseReport)).toBeHidden()
	})

	test('finds a word that appears only inside a note', async ({ page }) => {
		const buried = await createNoteViaApi(page, 'Personal', 'Groceries', 'remember the zarquon')
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()

		await searchBox(page).fill('zarquon')

		// Nothing in the title says "zarquon", so only the server can match it.
		await expect(noteRow(page, buried)).toBeVisible()
		await expect(noteRow(page, workReport)).toBeHidden()
	})

	test('finds a curly apostrophe when a straight one is typed', async ({ page }) => {
		// What the rich editor writes when you type an apostrophe.
		const curly = await createNoteViaApi(page, 'Personal', 'Reading', 'I\u2019m deep into source material')
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()

		await searchBox(page).fill("I'm deep into source material")

		await expect(noteRow(page, curly)).toBeVisible()
	})

	test('matches notes on every term given', async ({ page }) => {
		const both = await createNoteViaApi(page, 'Personal', 'Trip', 'lisbon in november')
		await createNoteViaApi(page, 'Personal', 'Other', 'lisbon in may')
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()

		await searchBox(page).fill('lisbon november')

		await expect(noteRow(page, both)).toBeVisible()
		// The other note carries only one of the two terms.
		await expect(page.locator('a[href*="/note/"]')).toHaveCount(1)
	})

	test('puts the search box above the category list', async ({ page }) => {
		const field = page.locator('.app-navigation__search').getByRole('textbox', { name: 'Search for notes' })
		await expect(field).toBeVisible()

		// Above the heading, rather than splitting it from the tree below it.
		const box = (await field.boundingBox())!
		const heading = (await page.getByText('Categories', { exact: true }).first().boundingBox())!
		expect(box.y).toBeLessThan(heading.y)

		// Not in the note list header, where it used to sit.
		await expect(page.locator('.content-list').getByRole('textbox', { name: 'Search for notes' })).toHaveCount(0)
	})

	test('lines the search box up with the category rows', async ({ page }) => {
		const field = (await page.locator('.app-navigation__search input').boundingBox())!
		const row = (await page.locator('.app-navigation-entry').first().boundingBox())!

		expect(Math.round(field.x), 'the box starts where the rows do').toBe(Math.round(row.x))
		expect(Math.round(field.x + field.width), 'and ends where they do').toBe(Math.round(row.x + row.width))
	})

	test('says so when a search matches nothing', async ({ page }) => {
		await searchBox(page).fill('nothing here matches this at all')

		await expect(page.getByText('No results found')).toBeVisible()
		await expect(page.locator('a[href*="/note/"]')).toHaveCount(0)
	})

	test('no longer offers a separate way to search all categories', async ({ page }) => {
		await page.getByTitle('Work', { exact: true }).first().click()
		await searchBox(page).fill('report')

		await expect(page.getByRole('button', { name: 'Find in all categories' })).toBeHidden()
	})
})
