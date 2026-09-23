/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { newNoteButton } from '../support/note.ts'
import { NoteEditor } from '../support/sections/NoteEditor.ts'

/**
 * The color the browser actually paints, rather than the class that asked for it.
 *
 * @param locator the element to measure
 * @param property the CSS property to read back
 */
function painted(locator: Locator, property: string): Promise<string> {
	return locator.evaluate(
		(element, name) => window.getComputedStyle(element).getPropertyValue(name),
		property,
	)
}

test.describe('Rich editor text styling', () => {
	test.beforeEach(async ({ page }) => {
		await login(page)
		await page.goto('/index.php/apps/notes/')
		await expect(newNoteButton(page)).toBeVisible()
		await newNoteButton(page).click()

		// These rules only exist to correct the Text editor. Where the Text app
		// is not installed Notes falls back to its own CodeMirror editor, which
		// this says nothing about, so there is nothing here to measure.
		const editor = new NoteEditor(page)
		await expect(editor.el).toBeVisible()
		test.skip(await editor.codeMirror.count() > 0, 'the Text app is not installed')
	})

	test('renders emphasis in the body color instead of the core grey', async ({ page }) => {
		const editor = new NoteEditor(page)

		// Seed through the helper so the caret is known to be in the editor, then
		// type the markup by hand so Text's input rules actually fire.
		await editor.type('Names refer to ')
		await editor.expectText('Names refer to')
		await page.keyboard.type('*their bearers* ')

		const emphasis = editor.surface.locator('em').first()
		await expect(emphasis).toBeVisible()

		// Nextcloud core paints em with --color-text-maxcontrast, which reads as
		// washed-out grey next to the body text. It has to match the block it
		// sits in — which is that block whatever it is, since a new note starts
		// on its title line rather than in a paragraph.
		expect(await painted(emphasis, 'color'))
			.toBe(await painted(emphasis.locator('xpath=..'), 'color'))
	})

	test('highlights on a ground that keeps the text readable', async ({ page }) => {
		const editor = new NoteEditor(page)

		await editor.type('a ')
		await editor.expectText('a')
		await page.keyboard.type('==highlighted== phrase')

		const highlight = editor.surface.locator('mark').first()
		await expect(highlight).toBeVisible()

		// The browser's own mark styling forces near-black text, which against the
		// dark theme's --color-mark is unreadable. The text has to follow the
		// block it sits in; the ground stays whatever core themed it.
		expect(await painted(highlight, 'color'))
			.toBe(await painted(highlight.locator('xpath=..'), 'color'))
	})
})
