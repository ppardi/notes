/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, newNoteButton, noteContent, setNoteMode, uniqueTitle } from '../support/note.ts'

const BODY = '# Fold probe\n'
	+ '\n'
	+ 'Intro line before any section.\n'
	+ '\n'
	+ '## Groceries\n'
	+ '\n'
	+ '- milk\n'
	+ '- bread\n'
	+ '\n'
	+ '### Dairy detail\n'
	+ '\n'
	+ 'Cheese and yoghurt.\n'
	+ '\n'
	+ '## Travel\n'
	+ '\n'
	+ 'Flight at 6am.\n'

function surface(page: Page): Locator {
	return page.locator('.ProseMirror').first()
}

/* A folded block is still in the document — it is only not drawn — so these
   ask what the reader can see rather than what the text says. */
function groceriesList(page: Page): Locator {
	return surface(page).locator('ul').first()
}

function dairyHeading(page: Page): Locator {
	return surface(page).locator('h3', { hasText: 'Dairy detail' }).first()
}

function travelLine(page: Page): Locator {
	return surface(page).locator('p', { hasText: 'Flight at 6am.' }).first()
}

/**
 * The heading that folds a section: the heading is the control.
 *
 * @param page the page under test
 * @param heading the heading's text
 */
function headingNamed(page: Page, heading: string): Locator {
	return surface(page)
		.locator(`h1:has-text("${heading}"), h2:has-text("${heading}"), h3:has-text("${heading}")`)
		.first()
}

/**
 * The control left for people not using a mouse.
 *
 * @param page the page under test
 * @param heading the heading's text
 */
function foldControl(page: Page, heading: string): Locator {
	return headingNamed(page, heading).locator('.note-fold__toggle')
}

/**
 * Click a heading as a person would, one separate click at a time.
 *
 * Two clicks in quick succession at the same spot are a double click, which
 * the editor routes elsewhere, so these are deliberately spaced.
 *
 * @param page the page under test
 * @param heading the heading's text
 */
async function clickHeading(page: Page, heading: string): Promise<void> {
	await headingNamed(page, heading).click()
	await page.waitForTimeout(500)
}

/**
 * Open a note and wait for Text to have it on screen.
 *
 * @param page the page under test
 * @param noteId the note to open
 */
async function openNote(page: Page, noteId: number): Promise<void> {
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
	await expect(newNoteButton(page).first()).toBeVisible()
	await expect(surface(page)).toBeVisible()
	// Folding is live once Text has handed over its editor.
	await expect(foldControl(page, 'Groceries')).toBeAttached()
}

test.describe('Folding sections under their headings', () => {
	test.beforeEach(async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
	})

	test('folds a section away and brings it back', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold', testInfo), BODY)
		await openNote(page, noteId)

		await expect(groceriesList(page)).toBeVisible()
		await clickHeading(page, 'Groceries')

		// The section and the subsection inside it both go out of sight.
		await expect(groceriesList(page)).toBeHidden()
		await expect(dairyHeading(page)).toBeHidden()
		// The next section is left where it was.
		await expect(travelLine(page)).toBeVisible()
		// And it says what it is holding back.
		await expect(surface(page).locator('.note-fold__badge')).toHaveText('3 blocks hidden')

		await clickHeading(page, 'Groceries')
		await expect(groceriesList(page)).toBeVisible()
		await expect(dairyHeading(page)).toBeVisible()
	})

	test('leaves the note itself exactly as it was', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-file', testInfo), BODY)
		await openNote(page, noteId)

		await clickHeading(page, 'Groceries')
		await expect(groceriesList(page)).toBeHidden()

		// Type into a section that is still open, so the note is written out
		// while another one is folded.
		await travelLine(page).click()
		await page.keyboard.press('End')
		await page.keyboard.type(' Gate B12.')

		await expect.poll(() => noteContent(noteId), { timeout: 20000 })
			.toContain('Gate B12.')
		const content = await noteContent(noteId)
		// The folded section is still in the file, and nothing the fold drew
		// has leaked into it.
		expect(content).toContain('- milk')
		expect(content).toContain('Cheese and yoghurt.')
		expect(content).not.toMatch(/[▸▾]/)
		expect(content).not.toContain('blocks hidden')
	})

	test('can be reached without a mouse', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-keys', testInfo), BODY)
		await openNote(page, noteId)

		const control = foldControl(page, 'Groceries')
		await control.focus()
		await expect(control).toHaveAttribute('aria-expanded', 'true')
		await page.keyboard.press('Enter')

		await expect(groceriesList(page)).toBeHidden()
		await expect(foldControl(page, 'Groceries')).toHaveAttribute('aria-expanded', 'false')
	})

	test('does not fold when a word in the heading is double clicked', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-dblclick', testInfo), BODY)
		await openNote(page, noteId)

		/* Double clicking is how a word gets selected. The editor sends the
		   opening click through as an ordinary one, so without care that
		   gesture would take the section away while it was being edited. */
		await headingNamed(page, 'Groceries').dblclick()
		await page.waitForTimeout(500)

		await expect(groceriesList(page)).toBeVisible()
		await expect(surface(page).locator('.note-fold__badge')).toHaveCount(0)
	})

	test('keeps every heading level on the same edge as the prose', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-align', testInfo), BODY)
		await openNote(page, noteId)

		/* Nothing is drawn beside a heading to fold it, so nothing pushes one
		   in from the text below it. A control set in the line would indent
		   every heading, and by a different amount at each level. */
		const edges = await surface(page).evaluate((root: Element) => [...root.children]
			.filter((el) => (el as HTMLElement).offsetParent !== null)
			.map((el) => ({ tag: el.tagName, left: Math.round(el.getBoundingClientRect().left) })))
		const prose = edges.find((e) => e.tag === 'P')!.left
		for (const edge of edges.filter((e) => /^H[1-6]$/.test(e.tag))) {
			expect(edge.left, `${edge.tag} should start where the prose does`).toBe(prose)
		}
		// And the text inside them, not merely the boxes.
		const textStart = await headingNamed(page, 'Travel').evaluate((el: Element) => {
			const range = document.createRange()
			const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!
			range.selectNodeContents(text)
			return Math.round(range.getBoundingClientRect().left)
		})
		expect(textStart).toBe(prose)
	})

	test('opens every section again when the note is reopened', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-fresh', testInfo), BODY)
		await openNote(page, noteId)

		await clickHeading(page, 'Groceries')
		await expect(groceriesList(page)).toBeHidden()

		// What is folded is never written down, so it does not come back.
		await page.reload()
		await expect(surface(page)).toBeVisible()
		await expect(groceriesList(page)).toBeVisible()
	})
})
