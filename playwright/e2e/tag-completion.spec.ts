/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaApi, deleteAllNotes, newNoteButton, noteContent, setNoteMode } from '../support/note.ts'

function completions(page: Page): Locator {
	return page.locator('.tag-completion')
}

function surface(page: Page): Locator {
	return page.locator('.ProseMirror').first()
}

/**
 * Open a note with the caret in it and everything typed so far thrown away.
 *
 * @param page the page under test
 * @param noteId the note to type into
 */
async function startTyping(page: Page, noteId: number): Promise<void> {
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
	await expect(newNoteButton(page).first()).toBeVisible()
	await expect(surface(page)).toBeVisible()
	await surface(page).click()
	await surface(page).press('ControlOrMeta+a')
}

/**
 * How far right the caret has reached.
 *
 * @param page the page under test
 */
function caretRight(page: Page): Promise<number> {
	return page.evaluate(() => {
		const selection = window.getSelection()
		if (!selection || selection.rangeCount === 0) {
			return 0
		}
		return selection.getRangeAt(0).getBoundingClientRect().right
	})
}

/**
 * Whether an element sits entirely within the window.
 *
 * @param locator the element to measure
 */
async function isOnScreen(locator: Locator): Promise<boolean> {
	return locator.evaluate((element) => {
		const box = element.getBoundingClientRect()
		return box.left >= 0
			&& box.top >= 0
			&& box.right <= window.innerWidth
			&& box.bottom <= window.innerHeight
	})
}

test.describe('Tag completion', () => {
	test.beforeEach(async ({ page, request }) => {
		// The completion belongs to the rich editor; the markdown editor has
		// none of it.
		await setNoteMode(request, 'rich')
		await login(page)
		await deleteAllNotes(page)
		// the tags to complete against
		await createNoteViaApi(page, 'Personal', 'Reading list', 'on #philosophy, #phenomenology and #physics')
	})

	test.afterEach(async ({ request }) => {
		await setNoteMode(request, 'rich')
	})

	test('completes a tag that is already in use', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Typing here', 'start')
		await startTyping(page, target)

		await page.keyboard.insertText('reading about ')
		await page.keyboard.type('#phil')

		await expect(completions(page)).toBeVisible()
		await expect(completions(page).locator('li')).toHaveText(['#philosophy'])

		await page.keyboard.press('Enter')

		await expect(surface(page)).toContainText('#philosophy')
		// and it reaches the note, rather than only the screen
		await expect.poll(() => noteContent(target), { timeout: 20000 }).toContain('#philosophy')
	})

	test('offers every tag that starts the same way, newest choice first', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Several', 'start')
		await startTyping(page, target)

		await page.keyboard.type('#ph')

		await expect(completions(page).locator('li'))
			.toHaveText(['#phenomenology', '#philosophy', '#physics'])

		// the arrow keys move through them rather than through the note
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Enter')
		await expect(surface(page)).toContainText('#philosophy')
	})

	/* Wide enough to stay out of the mobile layout, which hides the note list
	   and with it the button these tests wait for. */
	const DESKTOP = { width: 1100, height: 700 }

	test('stays on the screen wherever the caret has got to', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Edge case', 'start')
		await page.setViewportSize(DESKTOP)
		await startTyping(page, target)

		/* Lines of several lengths, so the caret lands all across the editor —
		   including hard against the right margin, which is where a list pinned
		   to the caret would hang off the window. */
		let furthest = 0
		for (const words of [2, 6, 10, 14, 18, 22]) {
			await surface(page).press('ControlOrMeta+a')
			await page.keyboard.insertText(`${Array(words).fill('designator').join(' ')} `)
			await page.keyboard.type('#ph')

			await expect(completions(page)).toBeVisible()
			expect(await isOnScreen(completions(page)), `with ${words} words before it`).toBe(true)
			furthest = Math.max(furthest, await caretRight(page))
			await page.keyboard.press('Escape')
		}

		// the sweep has to have reached the right-hand side, or it proves nothing
		expect(furthest, 'the caret reached the right of the window')
			.toBeGreaterThan(DESKTOP.width * 0.6)
	})

	test('opens above the line when there is no room below it', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Bottom edge', 'start')
		await page.setViewportSize(DESKTOP)
		await startTyping(page, target)

		// fill the editor so the caret ends up at the foot of the window
		for (let line = 0; line < 25; line++) {
			await page.keyboard.insertText(`line ${line}`)
			await page.keyboard.press('Enter')
		}
		await page.keyboard.type('#ph')

		await expect(completions(page)).toBeVisible()
		expect(await isOnScreen(completions(page)), 'the list is inside the window').toBe(true)

		// above the caret, rather than off the bottom
		const caret = await caretRight(page)
		expect(caret).toBeGreaterThan(0)
		const list = await completions(page).boundingBox()
		const caretBox = await page.evaluate(() => {
			const selection = window.getSelection()
			return selection?.getRangeAt(0).getBoundingClientRect().top ?? 0
		})
		expect(list!.y + list!.height).toBeLessThanOrEqual(caretBox + 1)
	})

	test('says nothing about a tag that is not in use yet', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'New tag', 'start')
		await startTyping(page, target)

		await page.keyboard.type('#somethingnobodyhasused')

		await expect(completions(page)).toHaveCount(0)
	})

	test('closes on Escape, and stays closed', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Dismissed', 'start')
		await startTyping(page, target)

		await page.keyboard.type('#ph')
		await expect(completions(page)).toBeVisible()

		await page.keyboard.press('Escape')

		/* The keyup that follows Escape must not put the list straight back up,
		   which is what this count catches. */
		await expect(completions(page)).toHaveCount(0)
		await expect(surface(page)).toContainText('#ph')

		// writing more of the word is a fresh question, so it opens again
		await page.keyboard.type('il')
		await expect(completions(page)).toBeVisible()
	})

	test('leaves ordinary typing alone', async ({ page }) => {
		const target = await createNoteViaApi(page, 'Personal', 'Plain typing', 'start')
		await startTyping(page, target)

		// Enter still breaks the line
		await page.keyboard.insertText('first line')
		await page.keyboard.press('Enter')
		await page.keyboard.insertText('second line')
		await expect(surface(page)).toContainText('first line')
		await expect(surface(page)).toContainText('second line')

		// and a hash at the start of a line still makes a heading
		await page.keyboard.press('Enter')
		await page.keyboard.type('# a heading ')
		await expect(surface(page).locator('h1, h2, h3')).toHaveCount(2)
	})
})
