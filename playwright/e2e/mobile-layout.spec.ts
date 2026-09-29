/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, setNoteMode } from '../support/note.ts'

const BODY = '# Drift\n'
	+ '\n'
	+ 'A fairly long paragraph of prose that wraps across several lines on a\n'
	+ 'narrow screen, so there is something to scroll past.\n'
	+ '\n'
	+ '## Section\n'
	+ '\n'
	+ '- milk\n'
	+ '- bread\n'

/**
 * How far the note pane can be dragged sideways.
 *
 * A thumb moves whatever will move, so a pane a little wider than itself slides
 * left and right while the reader is only trying to scroll down. A pointing
 * device never finds this, which is why it shows up on a phone and not on a
 * desk.
 *
 * @param page the page under test
 */
async function pannableBy(page: Page): Promise<number> {
	return page.evaluate(() => {
		const pane = document.querySelector('.app-content-details') as HTMLElement
		return pane ? pane.scrollWidth - pane.clientWidth : -1
	})
}

async function openNote(page: Page, noteId: number): Promise<void> {
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
	await expect(page.locator('.ProseMirror').first()).toBeVisible()
	await expect(page.locator('.text-menubar')).toBeAttached()
}

/* Portrait on a phone and portrait on a tablet are both under Nextcloud's
   mobile breakpoint; landscape on a tablet is over it, and is there to say the
   desktop layout was never the one at fault. */
const SIZES: [string, number, number][] = [
	['a phone in portrait', 390, 844],
	['a tablet in portrait', 834, 1194],
	['a tablet in landscape', 1194, 834],
]

test.describe('The note pane on a touch screen', () => {
	for (const [label, width, height] of SIZES) {
		test.describe(label, () => {
			test.use({ viewport: { width, height } })

			test('keeps the editor toolbar within the window', async ({ page, request }) => {
				/* The toolbar sits at the bottom of the note pane, so a pane that
				   runs past the bottom of the window takes the toolbar with it.
				   It can then only be seen by overscrolling, and springs back the
				   moment you let go. */
				await login(page)
				await deleteAllNotesVia()
				await setNoteMode(request, 'rich')
				const noteId = await createNoteViaRequest('', 'Drift', BODY)
				await openNote(page, noteId)

				const fit = await page.evaluate(() => {
					const pane = document.querySelector('.app-content-details') as HTMLElement
					const bar = document.querySelector('.text-menubar') as HTMLElement
					return {
						paneBelow: Math.round(pane.getBoundingClientRect().bottom - window.innerHeight),
						barBelow: Math.round(bar.getBoundingClientRect().bottom - window.innerHeight),
					}
				})
				expect(fit.paneBelow, 'the pane ends at or above the bottom of the window')
					.toBeLessThanOrEqual(0)
				expect(fit.barBelow, 'so does the toolbar').toBeLessThanOrEqual(0)
			})

			test('does not slide sideways', async ({ page, request }) => {
				await login(page)
				await deleteAllNotesVia()
				await setNoteMode(request, 'rich')
				const noteId = await createNoteViaRequest('', 'Drift', BODY)
				await openNote(page, noteId)

				await expect.poll(() => pannableBy(page)).toBe(0)
			})
		})
	}
})
