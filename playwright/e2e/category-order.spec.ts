/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaApi, createNoteViaRequest, deleteAllNotesVia, newNoteButton, setSmartCategories } from '../support/note.ts'

function apiHeaders(): Record<string, string> {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	return {
		Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
		// Without this the settings route answers 412.
		'OCS-APIRequest': 'true',
	}
}

async function putSettings(request: APIRequestContext, settings: object): Promise<void> {
	const response = await request.put('/index.php/apps/notes/settings', {
		headers: apiHeaders(),
		data: settings,
	})
	expect(response.ok(), `writing settings: HTTP ${response.status()}`).toBeTruthy()
}

async function getSettings(request: APIRequestContext): Promise<Record<string, unknown>> {
	const response = await request.get('/index.php/apps/notes/settings', { headers: apiHeaders() })
	expect(response.ok(), `reading settings: HTTP ${response.status()}`).toBeTruthy()
	return await response.json() as Record<string, unknown>
}

/** The arrangement as the server has it. */
async function storedOrder(request: APIRequestContext): Promise<string[]> {
	return (await getSettings(request)).categoryOrder as string[]
}

/** The top-level category rows, in the order they are rendered. */
async function topLevelOrder(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const links = Array.from(document.querySelectorAll('.app-navigation-entry-link[title]'))
		return links
			/* Category rows carry draggable, which the navigation's own links
			   (Zen mode, Notes settings) do not. Unfiled carries it as false. */
			.filter((el) => el.closest('li')?.hasAttribute('draggable'))
			// a nested row sits inside its parent's children list
			.filter((el) => !el.closest('.app-navigation-entry__children'))
			.map((el) => (el as HTMLElement).title)
			.filter((title) => title !== '' && title !== 'Unfiled')
	})
}

/** Drop a category onto the top or bottom edge of a row: the slot band. */
async function dragCategoryBeside(page: Page, from: string, to: string, side: 'before' | 'after', drop = true): Promise<void> {
	await page.evaluate(([fromName, toName, which, shouldDrop]) => {
		const source = document.querySelector(`[title="${fromName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const target = document.querySelector(`[title="${toName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const box = target.getBoundingClientRect()
		const edge = {
			clientX: box.left + box.width / 2,
			clientY: which === 'before' ? box.top + 1 : box.bottom - 1,
		}
		const transfer = new DataTransfer()
		source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
		target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, ...edge }))
		if (shouldDrop) {
			target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, ...edge }))
		}
	}, [from, to, side, drop] as [string, string, string, boolean])
}

/** Drop a category onto the middle of a row: the nesting band. */
async function dragCategoryOnto(page: Page, from: string, to: string): Promise<void> {
	await page.evaluate(([fromName, toName]) => {
		const source = document.querySelector(`[title="${fromName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const target = document.querySelector(`[title="${toName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const box = target.getBoundingClientRect()
		const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
		const transfer = new DataTransfer()
		source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
		target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }))
		target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, ...at }))
	}, [from, to])
}

/** The category a note is filed in, read straight from the API. */
async function noteCategory(request: APIRequestContext, noteId: number): Promise<string> {
	const response = await request.get(`/index.php/apps/notes/api/v1/notes/${noteId}`, { headers: apiHeaders() })
	expect(response.ok()).toBeTruthy()
	return (await response.json()).category as string
}

/** The children of a category, in the order they are rendered. */
async function childrenOrder(page: Page, parent: string): Promise<string[]> {
	return page.evaluate((name) => {
		const row = document.querySelector(`[title="${name}"]`)?.closest('li')
		const children = row?.querySelector('.app-navigation-entry__children')
		if (!children) {
			return []
		}
		return Array.from(children.querySelectorAll(':scope > li > .app-navigation-entry [title]'))
			.map((el) => (el as HTMLElement).title)
	}, parent)
}

/** Make a category from the Categories heading. */
async function createCategory(page: Page, name: string): Promise<void> {
	await page.getByRole('button', { name: 'Add category', exact: true }).click()
	await page.getByRole('menuitem', { name: 'New category', exact: true }).click()
	const input = page.getByPlaceholder('New category', { exact: true })
	await expect(input).toBeVisible()
	await input.fill(name)
	await input.press('Enter')
	await expect(page.getByTitle(name, { exact: true }).first()).toBeVisible()
}

async function openCategoryActions(page: Page, category: string): Promise<void> {
	const row = page.getByTitle(category, { exact: true }).first().locator('xpath=ancestor::li[1]')
	await row.hover()
	await row.getByRole('button', { name: 'Actions', exact: true }).first().click()
}

async function renameCategory(page: Page, from: string, to: string): Promise<void> {
	await openCategoryActions(page, from)
	await page.getByRole('menuitem', { name: 'Rename category', exact: true }).click()
	const input = page.getByPlaceholder(from, { exact: true })
	await expect(input).toBeVisible()
	await input.fill(to)
	await input.press('Enter')
}

async function deleteCategory(page: Page, category: string): Promise<void> {
	await openCategoryActions(page, category)
	await page.getByRole('menuitem', { name: 'Delete category', exact: true }).click()
	const confirm = page.getByRole('button', { name: 'Delete', exact: true })
	if (await confirm.isVisible().catch(() => false)) {
		await confirm.click()
	}
	await expect(page.getByTitle(category, { exact: true })).toHaveCount(0)
}

test.describe('Category order', () => {
	test.afterEach(async ({ request }) => {
		await putSettings(request, { categoryOrder: [] })
	})

	test('stores and returns a category order', async ({ request }) => {
		await putSettings(request, { categoryOrder: ['Beta', 'Alpha'] })
		expect(await getSettings(request)).toMatchObject({ categoryOrder: ['Beta', 'Alpha'] })
	})

	/* The cap. The first thousand keys survive in order; the rest are dropped,
	   which surfaces those categories at the top of their groups as slotless
	   rather than scrambling the arrangement. */
	test('keeps the first thousand keys and drops the rest', async ({ request }) => {
		const keys = Array.from({ length: 1200 }, (_, i) => `C${i}`)
		await putSettings(request, { categoryOrder: keys })

		const stored = (await getSettings(request)).categoryOrder as string[]
		expect(stored).toHaveLength(1000)
		expect(stored[0]).toBe('C0')
		expect(stored[999]).toBe('C999')
	})

	test.describe('arranging', () => {
		let childNote: number

		test.beforeEach(async ({ page, request }) => {
			await login(page)
			await deleteAllNotesVia()
			await putSettings(request, { categoryOrder: [] })
			await setSmartCategories([])
			await createNoteViaApi(page, 'Alpha', 'In Alpha')
			await createNoteViaApi(page, 'Mike', 'In Mike')
			await createNoteViaApi(page, 'Zulu', 'In Zulu')
			childNote = await createNoteViaApi(page, 'Alpha/Child', 'In Child')
			await page.goto('/index.php/apps/notes/')
			await expect(newNoteButton(page).first()).toBeVisible()
		})

		test('drops a category into the slot it was aimed at', async ({ page, request }) => {
			await expect.poll(() => topLevelOrder(page)).toEqual(['Alpha', 'Mike', 'Zulu'])

			await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
			await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Mike'])
			await expect.poll(() => storedOrder(request)).toEqual(['Zulu', 'Alpha', 'Mike'])

			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Mike'])
		})

		test('reorders among siblings without moving the folder', async ({ page, request }) => {
			// A pure reorder is a settings write and nothing else.
			const before = await noteCategory(request, childNote)

			await dragCategoryBeside(page, 'Mike', 'Alpha', 'before')
			await expect.poll(() => topLevelOrder(page)).toEqual(['Mike', 'Alpha', 'Zulu'])

			expect(await noteCategory(request, childNote)).toBe(before)
		})

		test('keeps a smart category where it was dropped', async ({ page, request }) => {
			await createNoteViaRequest('', 'Tagged', 'On #reading')
			/* The row's title attribute is its tag description, which is what
			   topLevelOrder reads and what the drag helper looks it up by. */
			await setSmartCategories([
				{ id: 'reading', name: 'Reading', tags: ['reading'], mode: 'any', parent: '' },
			])
			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['Alpha', 'Mike', '#reading', 'Zulu'])

			await dragCategoryBeside(page, '#reading', 'Alpha', 'before')
			await expect.poll(() => topLevelOrder(page)).toEqual(['#reading', 'Alpha', 'Mike', 'Zulu'])
			await expect.poll(() => storedOrder(request)).toContain('smart:reading')

			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['#reading', 'Alpha', 'Mike', 'Zulu'])
		})

		test('puts a new category at the top of its group', async ({ page, request }) => {
			await createCategory(page, 'Newest')
			await expect.poll(() => topLevelOrder(page)).toEqual(['Newest', 'Alpha', 'Mike', 'Zulu'])
			await expect.poll(() => storedOrder(request)).toContain('Newest')

			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['Newest', 'Alpha', 'Mike', 'Zulu'])
		})

		/* Renaming the LAST of the group on purpose: a key that stopped being
		   recognised would make the category unarranged, and an unarranged one
		   sorts to the top - so a rename that lost the key would look like a
		   category jumping to the front. */
		test('keeps the arrangement when a category is renamed', async ({ page, request }) => {
			await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
			await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Mike'])

			await renameCategory(page, 'Mike', 'Renamed')
			/* The rename and its settings write are two requests; reloading
			   before the second lands would abort it. */
			await expect.poll(() => storedOrder(request)).toContain('Renamed')
			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['Zulu', 'Alpha', 'Renamed'])
		})

		/* Into a group that already holds something, so the slot it takes is
		   visible: carrying its old index across would put it after Child,
		   where that index means nothing. */
		test('re-slots a category renamed into another group', async ({ page, request }) => {
			await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
			await renameCategory(page, 'Zulu', 'Alpha/Zulu')
			await expect.poll(() => storedOrder(request)).toContain('Alpha/Zulu')

			await page.reload()
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect.poll(() => topLevelOrder(page)).toEqual(['Alpha', 'Mike'])
			await expect.poll(() => childrenOrder(page, 'Alpha')).toEqual(['Zulu', 'Child'])
		})

		test('drops the slot of a category that is deleted', async ({ page, request }) => {
			await dragCategoryBeside(page, 'Zulu', 'Alpha', 'before')
			expect((await getSettings(request)).categoryOrder).toContain('Zulu')

			await deleteCategory(page, 'Zulu')
			await expect.poll(async () => (await getSettings(request)).categoryOrder).not.toContain('Zulu')
		})

		test('opens on the unfiled category when nothing was last viewed', async ({ page, request }) => {
			await putSettings(request, { lastViewedCategory: null })
			await page.goto('/index.php/apps/notes/')
			await expect(newNoteButton(page).first()).toBeVisible()
			await expect(page.getByRole('link', { name: 'Unfiled', exact: true }))
				.toHaveAttribute('aria-current', 'page')
		})

		test('still welcomes a first run that lands on unfiled', async ({ page, request }) => {
			await deleteAllNotesVia()
			await putSettings(request, { lastViewedCategory: null })
			await page.goto('/index.php/apps/notes/')
			await expect(page.getByText('Write down your thoughts without any distractions.')).toBeVisible()
		})

		test('refuses a drop inside the dragged category and writes nothing', async ({ page, request }) => {
			const before = await getSettings(request)

			await dragCategoryOnto(page, 'Alpha', 'Child')

			await expect.poll(() => topLevelOrder(page)).toEqual(['Alpha', 'Mike', 'Zulu'])
			expect((await getSettings(request)).categoryOrder).toEqual(before.categoryOrder)
		})
	})
})
