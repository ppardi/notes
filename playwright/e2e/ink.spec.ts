/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { expect, test } from '@playwright/test'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, noteContent, setNoteMode } from '../support/note.ts'

test.describe('Ink', () => {
	test('puts an image and a link into the note', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const noteId = await createNoteViaRequest('', 'Inked', 'Typed already.\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas')
		await expect(canvas).toBeVisible()

		const box = (await canvas.boundingBox())!
		await page.mouse.move(box.x + 50, box.y + 50)
		await page.mouse.down()
		await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 })
			.toMatch(/!\[[^\]]*\]\(\.attachments\.\d+\/ink-[A-Za-z0-9_-]+\.png\)/)
		expect(await noteContent(noteId)).toMatch(/\]\(.*\/apps\/notes\/ink\/[A-Za-z0-9_-]+\)/)
		expect(await noteContent(noteId)).toContain('Typed already.')
	})
})
