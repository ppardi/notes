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
 * Text's own "link to this section" control, which shares the margin.
 *
 * @param page the page under test
 * @param heading the heading's text
 */
function sectionAnchor(page: Page, heading: string): Locator {
	return headingNamed(page, heading).locator('.heading-anchor')
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
		await foldControl(page, 'Groceries').click()

		// The section and the subsection inside it both go out of sight.
		await expect(groceriesList(page)).toBeHidden()
		await expect(dairyHeading(page)).toBeHidden()
		// The next section is left where it was.
		await expect(travelLine(page)).toBeVisible()
		// And it says what it is holding back.
		await expect(surface(page).locator('.note-fold__badge')).toHaveText('3 blocks hidden')

		await foldControl(page, 'Groceries').click()
		await expect(groceriesList(page)).toBeVisible()
		await expect(dairyHeading(page)).toBeVisible()
	})

	test('leaves the note itself exactly as it was', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-file', testInfo), BODY)
		await openNote(page, noteId)

		await foldControl(page, 'Groceries').click()
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

	test('leaves the section alone when the heading is only being edited', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-edit', testInfo), BODY)
		await openNote(page, noteId)

		/* The heading is text, not a control. Clicking into it, selecting a
		   word in it and typing are all ordinary editing, and none of them
		   should take the section away from under the caret. */
		await headingNamed(page, 'Groceries').click()
		await expect(groceriesList(page)).toBeVisible()

		await headingNamed(page, 'Groceries').dblclick()
		await expect(groceriesList(page)).toBeVisible()

		// Collapse the word selection the double click made, rather than
		// typing over it, then add to the heading.
		await page.keyboard.press('ArrowRight')
		await page.keyboard.type(' list')
		await expect(groceriesList(page)).toBeVisible()
		await expect(headingNamed(page, 'Groceries')).toContainText('Groceries list')
	})

	test('hands the margin back to Text while a heading is being written', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-rail', testInfo), BODY)
		await openNote(page, noteId)

		/* Only one control can have that margin. Folding keeps it while the
		   note is being read... */
		await expect(foldControl(page, 'Travel')).toBeVisible()
		await expect(sectionAnchor(page, 'Travel')).toBeHidden()

		// ...and gives it back once that heading is the one being written in.
		await headingNamed(page, 'Travel').click()
		await expect(foldControl(page, 'Travel')).toBeHidden()
		await expect(sectionAnchor(page, 'Travel')).toBeAttached()

		// Every other heading keeps its control.
		await expect(foldControl(page, 'Groceries')).toBeVisible()

		// And the caret leaving hands it straight back.
		await travelLine(page).click()
		await expect(foldControl(page, 'Travel')).toBeVisible()
	})

	test('keeps the control on a folded heading being written in', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-keep', testInfo), BODY)
		await openNote(page, noteId)

		await foldControl(page, 'Groceries').click()
		await expect(groceriesList(page)).toBeHidden()

		/* Handing the margin back here would leave nothing to unfold with, and
		   a fold that cannot be undone is a section that has gone missing. */
		await headingNamed(page, 'Groceries').click()
		await expect(foldControl(page, 'Groceries')).toBeVisible()
		await foldControl(page, 'Groceries').click()
		await expect(groceriesList(page)).toBeVisible()
	})

	test('offers a control big enough to hit', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-target', testInfo), BODY)
		await openNote(page, noteId)

		/* 24x24 CSS pixels is the floor WCAG sets for a pointer target, and a
		   fold control is small by nature: it carries one glyph and lives in a
		   margin. Sized from the glyph it comes out under that at every heading
		   level, which is the difference between aiming and just clicking. */
		const controls = surface(page).locator('.note-fold__toggle')
		const count = await controls.count()
		expect(count).toBeGreaterThan(1)

		let measured = 0
		for (let i = 0; i < count; i++) {
			const box = await controls.nth(i).boundingBox()
			if (box === null || box.width === 0) {
				continue // the heading being written in has handed its margin back
			}
			measured++
			expect(Math.round(box.width), `control ${i} width`).toBeGreaterThanOrEqual(24)
			expect(Math.round(box.height), `control ${i} height`).toBeGreaterThanOrEqual(24)
		}
		expect(measured).toBeGreaterThan(1)
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

	test('leaves the outline something to navigate to', async ({ page }, testInfo) => {
		/* Every entry in Text's outline points at the id on the heading anchor
		   that folding hides, and scrolls to it. Hidden the wrong way that anchor
		   draws no box, so there is nothing to scroll to and the whole panel
		   stops working, with no error anywhere to say so.

		   This drives the scroll itself rather than Text's panel: the panel
		   re-renders under the pointer, and what actually broke was the target,
		   not the list. */
		const long = Array.from({ length: 10 }, (unused, i) => `Padding paragraph ${i} to make the note scroll.`).join('\n\n')
		const body = `# Top\n\n${long}\n\n## Groceries\n\n${long}\n\n## Travel\n\nFlight at 6am.\n\n${long}\n`
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-outline', testInfo), body)
		await openNote(page, noteId)

		const anchor = surface(page).locator('h2:has-text("Travel") .heading-anchor').first()
		await expect(anchor).toBeAttached()
		// Out of sight, and taking no clicks from the control in front of it.
		await expect(anchor).toBeHidden()

		const scrolledToIt = await anchor.evaluate((el: Element) => {
			const scroller = el.closest('.app-content-details') as HTMLElement | null
				?? document.querySelector('.app-content-details') as HTMLElement | null
			if (!scroller || el.getClientRects().length === 0) {
				return { box: el.getClientRects().length > 0, before: 0, after: 0 }
			}
			scroller.scrollTop = 0
			const before = scroller.scrollTop
			el.scrollIntoView({ block: 'start' })
			return { box: true, before, after: scroller.scrollTop }
		})

		expect(scrolledToIt.box, 'the anchor must still draw a box to scroll to').toBe(true)
		expect(scrolledToIt.after).toBeGreaterThan(scrolledToIt.before)
	})

	test('opens every section again when the note is reopened', async ({ page }, testInfo) => {
		const noteId = await createNoteViaRequest('', uniqueTitle('fold-fresh', testInfo), BODY)
		await openNote(page, noteId)

		await foldControl(page, 'Groceries').click()
		await expect(groceriesList(page)).toBeHidden()

		// What is folded is never written down, so it does not come back.
		await page.reload()
		await expect(surface(page)).toBeVisible()
		await expect(groceriesList(page)).toBeVisible()
	})
})
