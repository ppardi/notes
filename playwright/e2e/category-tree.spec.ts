/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { APIRequestContext, Locator, Page } from '@playwright/test'

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
	expect(response.ok(), `creating note in "${category}"`).toBeTruthy()

	const note = await response.json() as { id: number }
	return note.id
}

function categoryRow(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true })
		.locator('xpath=ancestor::div[contains(@class,"app-navigation-entry")][1]')
}

/* The entry div, not the li: a parent's li also contains its descendants. */
function categoryCounter(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true })
		.locator('xpath=ancestor::div[contains(@class,"app-navigation-entry")][1]')
		.locator('.app-navigation-entry__counter-wrapper')
		.first()
}

function categoryLink(page: Page, name: string): Locator {
	return page.getByTitle(name, { exact: true }).first()
}

async function indentOf(page: Page, name: string): Promise<number> {
	const box = await categoryLink(page, name).boundingBox()
	return Math.round(box?.x ?? -1)
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

/* Playwright's dragTo drives the mouse, which does not start an HTML5 drag from
   a child of the draggable element. Dispatching the drag events with one shared
   DataTransfer exercises the app's own handlers instead. */
async function dragCategoryOnto(page: Page, from: string, to: string): Promise<void> {
	await page.evaluate(([fromName, toName]) => {
		const source = document.querySelector(`[title="${fromName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const target = document.querySelector(`[title="${toName}"]`)
			?.closest('.app-navigation-entry') as HTMLElement
		const transfer = new DataTransfer()
		source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
		target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
		target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
	}, [from, to])
}

/* Drives the pointer rather than dispatching one event, so the highlight is
   exercised the way a drag reaches a nested row: across its ancestors. The
   caller releases the button. */
async function dragNoteOver(page: Page, noteId: number, category: string): Promise<void> {
	const source = (await noteRow(page, noteId).boundingBox())!
	const target = (await categoryLink(page, category).boundingBox())!
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
	await page.mouse.down()
	await page.mouse.move(source.x - 20, source.y + source.height / 2, { steps: 5 })
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
	await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height / 2, { steps: 2 })
}

function highlightedCategories(page: Page): Promise<string[]> {
	return page.evaluate(() => Array.from(document.querySelectorAll('li.drop-over'))
		.map((li) => (li.querySelector('.app-navigation-entry-link') as HTMLElement)?.title))
}

/* The class alone says nothing about what is on screen: the rule that paints it
   has to reach the row as well. */
async function highlightAlpha(page: Page, category: string): Promise<number> {
	const color = await page.evaluate((name) => {
		const entry = document.querySelector(`[title="${name}"]`)?.closest('.app-navigation-entry') as HTMLElement
		return entry ? getComputedStyle(entry).backgroundColor : ''
	}, category)
	if (color === '' || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
		return 0
	}
	const alpha = /(?:,|\/)\s*([\d.]+)\s*\)$/.exec(color)
	return alpha ? Number(alpha[1]) : 1
}

test.describe('Category tree', () => {
	let deepNote: number
	let sageNote: number

	test.beforeEach(async ({ page }) => {
		await login(page)
		await deleteAllNotes(page)
		deepNote = await createNoteViaApi(page, 'PROJECTS/Apps/SAGE/Architecture', 'Deep note')
		sageNote = await createNoteViaApi(page, 'PROJECTS/Apps/SAGE', 'SAGE note')
		await createNoteViaApi(page, 'PROJECTS/Apps/Deskspace', 'Deskspace note')

		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page).first()).toBeVisible()
	})

	test.afterEach(async ({ request }) => {
		await clearStoredCategory(request)
	})

	test('shows categories the notes never declared', async ({ page }) => {
		// No note is filed in PROJECTS or PROJECTS/Apps directly.
		await expect(categoryLink(page, 'PROJECTS')).toBeVisible()
		await expect(categoryLink(page, 'Apps')).toBeVisible()
	})

	test('indents each level below its parent', async ({ page }) => {
		const projects = await indentOf(page, 'PROJECTS')
		const apps = await indentOf(page, 'Apps')
		const sage = await indentOf(page, 'SAGE')
		const architecture = await indentOf(page, 'Architecture')

		expect(apps).toBeGreaterThan(projects)
		expect(sage).toBeGreaterThan(apps)
		expect(architecture).toBeGreaterThan(sage)
	})

	test('counts only the notes filed directly in a category', async ({ page }) => {
		await expect(categoryCounter(page, 'SAGE')).toContainText('1')
		await expect(categoryCounter(page, 'Architecture')).toContainText('1')
		await expect(categoryCounter(page, 'Deskspace')).toContainText('1')
	})

	test('shows only the notes of the selected category, not those below it', async ({ page }) => {
		await categoryLink(page, 'SAGE').click()

		await expect(noteRow(page, sageNote)).toBeVisible()
		await expect(noteRow(page, deepNote)).toBeHidden()
	})

	test('remembers a collapsed category across a reload', async ({ page }) => {
		await expect(categoryLink(page, 'SAGE')).toBeVisible()

		const stored = page.waitForResponse((response) => response.url().includes('/apps/notes/settings') && response.request().method() === 'PUT')
		await categoryRow(page, 'Apps').getByRole('button', { name: 'Collapse' }).first().click()
		await stored

		await expect(categoryLink(page, 'SAGE')).toBeHidden()

		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		await expect(categoryLink(page, 'Apps')).toBeVisible()
		await expect(categoryLink(page, 'SAGE')).toBeHidden()
	})

	test('moves a note into a nested category by dragging it', async ({ page }) => {
		// A loose note, dragged onto a category three levels down.
		const loose = await createNoteViaApi(page, '', 'Loose note')
		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		await noteRow(page, loose).dragTo(categoryLink(page, 'Architecture'))

		const moved = await page.request.get(`/index.php/apps/notes/api/v1/notes/${loose}`, {
			headers: { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}` },
		})
		expect((await moved.json()).category).toBe('PROJECTS/Apps/SAGE/Architecture')
	})

	test('offers categories as draggable, but never the uncategorized one', async ({ page }) => {
		// The inbox only appears once a note is filed outside every category.
		await createNoteViaApi(page, '', 'Loose note')
		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		const draggable = async (name: string) => await page.getByTitle(name, { exact: true })
			.locator('xpath=ancestor::li[1]').first().getAttribute('draggable')

		expect(await draggable('SAGE')).toBe('true')
		expect(await draggable('Inbox')).toBe('false')
	})

	test('re-parents a category by dragging it onto another', async ({ page }) => {
		const sage = await indentOf(page, 'SAGE')

		await dragCategoryOnto(page, 'Deskspace', 'SAGE')

		// Deskspace and its note move under SAGE.
		await expect(categoryLink(page, 'Deskspace')).toBeVisible()
		await expect(async () => {
			expect(await indentOf(page, 'Deskspace')).toBeGreaterThan(sage)
		}).toPass()
		await expect(categoryCounter(page, 'Deskspace')).toContainText('1')
	})

	test('moves a category back to the top by dragging it onto All notes', async ({ page }) => {
		const topLevel = await indentOf(page, 'PROJECTS')

		await dragCategoryOnto(page, 'SAGE', 'All notes')

		await expect(async () => {
			expect(await indentOf(page, 'SAGE')).toBe(topLevel)
		}).toPass()
	})

	test('refuses to drop a category inside itself', async ({ page }) => {
		const before = await indentOf(page, 'SAGE')

		await dragCategoryOnto(page, 'Apps', 'Architecture')

		// Nothing moved: Apps is still an ancestor of SAGE.
		await page.waitForTimeout(800)
		expect(await indentOf(page, 'SAGE')).toBe(before)
		await expect(categoryLink(page, 'Apps')).toBeVisible()
	})

	test('highlights only the category a note is dragged over', async ({ page }) => {
		const loose = await createNoteViaApi(page, '', 'Loose note')
		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		// Drag the note over SAGE, which sits two levels down.
		await page.evaluate((noteId) => {
			const row = document.querySelector(`a[href*="/note/${noteId}"]`)?.closest('li') as HTMLElement
			const target = document.querySelector('[title="SAGE"]')
				?.closest('.app-navigation-entry') as HTMLElement
			const transfer = new DataTransfer()
			transfer.setData('application/x-nextcloud-notes-note-id', String(noteId))
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
			target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
		}, loose)

		await expect(async () => {
			const highlighted = await page.evaluate(() => Array.from(document.querySelectorAll('li.drop-over'))
				.map((li) => (li.querySelector('.app-navigation-entry-link') as HTMLElement)?.title))
			expect(highlighted).toEqual(['SAGE'])
		}).toPass({ timeout: 5000 })
	})

	test('paints the drop highlight on the nested category itself', async ({ page }) => {
		const loose = await createNoteViaApi(page, '', 'Loose note')
		await page.reload()
		await expect(newNoteButton(page).first()).toBeVisible()

		// A real pointer drag, which crosses the top-level ancestors on its way
		// to SAGE two levels down.
		await dragNoteOver(page, loose, 'SAGE')

		await expect(async () => {
			expect(await highlightedCategories(page)).toEqual(['SAGE'])
			expect(await highlightAlpha(page, 'SAGE')).toBeGreaterThan(0.5)
		}).toPass({ timeout: 5000 })

		await page.mouse.up()
	})

	test('selects a nested category from the tree', async ({ page }) => {
		await categoryLink(page, 'SAGE').click()

		await expect(page).toHaveURL(/[?&]category=PROJECTS\/Apps\/SAGE(&|$)/)
		await expect(categoryLink(page, 'SAGE')).toHaveAttribute('aria-current', 'page')
	})
})
