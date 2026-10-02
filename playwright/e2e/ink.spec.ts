/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Locator, Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { INK_DENSITY } from '../../src/inkRender.js'
import { login } from '../support/login.ts'
import { createNoteViaRequest, deleteAllNotesVia, deleteNoteAttachment, noteAttachment, noteContent, replaceNoteAttachment, setNoteContent, setNoteMode } from '../support/note.ts'

// The smallest PNG there is, so the pictures these tests read the style off
// are really there: Text renders a broken image as an icon and no <img> at
// all, and a test that found no <img> would pass for the wrong reason.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function openInkedNote(page: Page, request: Parameters<typeof setNoteMode>[0]): Promise<number> {
	await login(page)
	await deleteAllNotesVia()
	await setNoteMode(request, 'rich')
	const noteId = await createNoteViaRequest('', 'Inked', 'Typed already.\n')
	await page.goto(`/index.php/apps/notes/note/${noteId}`)
	await expect(page.locator('.ProseMirror').first()).toBeVisible()
	return noteId
}

async function drawAndFinish(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Ink', exact: true }).click()
	const canvas = page.locator('.ink__canvas--live')
	await expect(canvas).toBeVisible()
	// The canvas takes no strokes until it has looked for ink already there, and
	// Done is disabled until it has. Drawing before that drops the stroke silently.
	await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

	// Draw from the middle. The canvas is fixed to the whole viewport but sits
	// inside the content area's stacking context, so the app header and the
	// navigation sidebar are painted over its top and left edges and swallow a
	// stroke that starts there.
	const box = (await canvas.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + 100, y + 70, { steps: 10 })
	await page.mouse.up()
	// A stroke that landed is what makes Undo available.
	await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
	await page.getByRole('button', { name: 'Done' }).click()
}

// How much ink is on the page sheet, which is where loaded strokes are traced.
// Reading the pixels rather than asking whether Undo is enabled: a button says
// something was recorded, these say the ink is really on the page - and Undo
// now reverses only what was done on this canvas, so a page that was merely
// reopened has nothing to undo.
async function inkOnThePage(page: Page): Promise<number> {
	return await page.locator('.ink__canvas--page').evaluate((canvas: HTMLCanvasElement) => {
		const context = canvas.getContext('2d')!
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
		let painted = 0
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 0) {
				painted++
			}
		}
		return painted
	})
}

// Where the ink sits on the page sheet, in that canvas's own pixels. Read off
// the pixels rather than off the strokes: what is being checked is what the
// reader sees when they open their drawing.
async function inkBoxOnScreen(page: Page): Promise<{ left: number, top: number, width: number, height: number }> {
	return await page.locator('.ink__canvas--page').evaluate((canvas: HTMLCanvasElement) => {
		const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
		let left = Infinity
		let top = Infinity
		let right = -Infinity
		let bottom = -Infinity
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] === 0) {
				continue
			}
			const at = (i - 3) / 4
			const x = at % canvas.width
			const y = Math.floor(at / canvas.width)
			left = Math.min(left, x)
			top = Math.min(top, y)
			right = Math.max(right, x)
			bottom = Math.max(bottom, y)
		}
		return left === Infinity
			? { left: 0, top: 0, width: 0, height: 0 }
			: { left, top, width: right - left, height: bottom - top }
	})
}

// Which colors are actually painted on the page sheet, most-used first. Read
// off the pixels rather than off the strokes: what is being checked is what the
// reader sees when they open their drawing again.
async function inkColorsOnThePage(page: Page): Promise<string[]> {
	return await page.locator('.ink__canvas--page').evaluate((canvas: HTMLCanvasElement) => {
		const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
		const counts = new Map<string, number>()
		for (let i = 0; i < data.length; i += 4) {
			// Only pixels the nib covered fully. An antialiased edge is a blend
			// with the transparent ground and is not the color anything was
			// drawn in.
			//
			// This threshold is coupled to the nib: a 2.5 CSS pixel stroke at
			// INK_DENSITY has a solid core, and a much finer one might have
			// none at all. The caller asserts that something opaque was found,
			// so a nib thinned past this fails loudly rather than reporting an
			// empty page.
			if (data[i + 3] < 250) {
				continue
			}
			const hex = '#' + [data[i], data[i + 1], data[i + 2]]
				.map((v) => v.toString(16).padStart(2, '0')).join('')
			counts.set(hex, (counts.get(hex) ?? 0) + 1)
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
	})
}

// Which colors are actually in the saved PNG, most-used first: the picture the
// note shows, read from the <img> rather than from the dialog's page sheet. The
// sheet is rendered again from the strokes stored beside the picture, so it
// can only vouch for them; the PNG is the one artifact every other Nextcloud
// client sees, and a raster that had gone black while its strokes still said
// red would pass everything that reads the sheet.
//
// Drawing the image into a canvas of our own reads its source pixels. The
// CSS `filter` the theme puts on the <img> is applied when the element is
// composited and is not part of the image, so it is not in what is read back
// here: this is the color in the file whatever the theme.
async function inkColorsInTheNoteImage(image: Locator): Promise<string[]> {
	return await image.evaluate(async (img: HTMLImageElement) => {
		// A picture still loading has no pixels yet, which would read as an
		// empty drawing rather than as a wait.
		await img.decode()
		const canvas = document.createElement('canvas')
		canvas.width = img.naturalWidth
		canvas.height = img.naturalHeight
		const context = canvas.getContext('2d')!
		context.drawImage(img, 0, 0)
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
		const counts = new Map<string, number>()
		for (let i = 0; i < data.length; i += 4) {
			// Fully-opaque pixels only, for the reason given for the page
			// sheet above: an antialiased edge is a blend with the transparent
			// ground. The caller asserts that some were found.
			if (data[i + 3] < 250) {
				continue
			}
			const hex = '#' + [data[i], data[i + 1], data[i + 2]]
				.map((v) => v.toString(16).padStart(2, '0')).join('')
			counts.set(hex, (counts.get(hex) ?? 0) + 1)
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex)
	})
}

// Put the page on a known theme, whatever the account is set to.
//
// Three tests here assert what a filter computes to in light and then in dark.
// They used to read the account's own theme, which worked only because the e2e
// harness pins `enforce_theme` to light - and `dev/ipad.sh --dark` exists to
// unpin exactly that. A test that inherits its theme asserts whatever the
// container was last left in.
//
// Setting the attribute is not enough on its own: every theme's stylesheet is
// linked on every page so the theme can be switched without a reload, and the
// `[data-theme-*]` selectors have equal specificity, so with two attributes
// present source order decides and light.css is linked last. Every other theme
// attribute therefore comes off first.
async function putPageOnTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
	await page.evaluate((wanted) => {
		for (const attribute of [...document.body.attributes]) {
			if (attribute.name.startsWith('data-theme-')) {
				document.body.removeAttribute(attribute.name)
			}
		}
		document.body.setAttribute(`data-theme-${wanted}`, '')
	}, theme)
	// The themes define this variable and nothing else decides whether ink is
	// inverted, so it is also the proof that the swap took.
	await expect(page.locator('body')).toHaveCSS(
		'--background-invert-if-dark',
		theme === 'dark' ? 'invert(100%)' : 'no',
	)
}

test.describe('Ink', () => {
	test('puts the picture into the note', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)

		const image = new RegExp(`!\\[[^\\]]*\\]\\((\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)\\)`)
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
		const after = await noteContent(noteId)

		// The picture alone. The "Edit ink" line that used to follow it never
		// worked: Text's link bubble claims a click on a link in the editor.
		expect(after).not.toMatch(/apps\/notes\/ink\//)
		// And never wrapped in a link, which Text would discard anyway.
		expect(after).not.toMatch(/\[!\[/)

		// The title stays the first line, and the ink comes after what was typed.
		expect(after.split('\n')[0]).toBe('# Inked')
		expect(after.indexOf('Typed already.')).toBeGreaterThan(-1)
		expect(after.indexOf('![')).toBeGreaterThan(after.indexOf('Typed already.'))

		// The drawing itself reached the server, and is a PNG.
		const src = image.exec(after)![1]
		const bytes = await noteAttachment(noteId, src)
		expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
	})

	test('does not delete the text that was selected', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await page.getByText('Typed already.').click({ clickCount: 3 })
		await drawAndFinish(page)

		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')
		const after = await noteContent(noteId)
		expect(after.split('\n')[0]).toBe('# Inked')
		expect(after).toContain('Typed already.')
		expect(after.indexOf('![')).toBeGreaterThan(after.indexOf('Typed already.'))
	})

	test('reopens the ink, with the strokes still there', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		// The strokes came back and were traced, so this is the same ink and
		// not a new block.
		await expect.poll(async () => await inkOnThePage(page), { timeout: 10000 }).toBeGreaterThan(0)

		// Finishing again replaces the file; it must not add a second block.
		// Asserted on the editor's DOM, which changes at once, rather than on the
		// file, which a debounced autosave writes whenever it likes.
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		// By alt text: the editor draws other images of its own, such as the
		// icon beside a link.
		await expect(page.locator('.ProseMirror img[alt="Ink"]')).toHaveCount(1)
	})

	test('reopens the ink when the ink itself is tapped', async ({ page, request }) => {
		await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()

		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		// The strokes came back, so the tap reached the same ink and not a new block.
		await expect.poll(async () => await inkOnThePage(page), { timeout: 10000 }).toBeGreaterThan(0)
	})

	test('leaves an ordinary image alone when it is tapped', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const noteId = await createNoteViaRequest('', 'Photo', 'Typed already.\n\n![holiday](.attachments.1/holiday.png)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		// Only a tap on ink is claimed. A photo has to keep doing what Text does
		// with a photo, so no canvas may open for it.
		const photo = page.locator('figure[data-component="image-view"]')
		await expect(photo).toHaveCount(1)
		await photo.click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
	})

	test('follows the theme where it is rendered, and leaves other pictures alone', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const noteId = await createNoteViaRequest('', 'Themed', 'Typed already.\n')
		// Both really on disk, in this note's own folder, so both render.
		await replaceNoteAttachment(noteId, 'ink-abc123.png', PNG)
		await replaceNoteAttachment(noteId, 'holiday.png', PNG)
		await setNoteContent(noteId, `Typed already.\n\n![ink](.attachments.${noteId}/ink-abc123.png)\n\n![holiday](.attachments.${noteId}/holiday.png)\n`)
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()
		await expect(page.locator('figure[data-component="image-view"] img')).toHaveCount(2)

		// A dark theme is this variable and nothing else: Nextcloud sets it to
		// invert(100%) there and to `no`, which is not a filter, on a light one.
		// The server defines it on the body's [data-theme-<id>] attribute, so
		// that is where it has to be replaced - a rule on :root would lose to it
		// and prove nothing.
		//
		// Every theme the server can set is listed rather than just the default
		// one, because which attribute the body carries depends on the account's
		// own theme and on whether `enforce_theme` is set. The e2e harness pins
		// it to light, but `dev/ipad.sh --dark` exists precisely to unpin it, and
		// a test that silently stopped simulating anything would then pass for
		// the wrong reason - it computed `none` against an expectation of `none`.
		await page.addStyleTag({ content: `
			[data-theme-default], [data-theme-light], [data-theme-dark],
			[data-theme-light-highcontrast], [data-theme-dark-highcontrast] {
				--background-invert-if-dark: invert(100%);
			}` })

		// Proof the line above did something. Without it the rest of this test
		// cannot fail: an unmatched rule and an unfiltered picture both read
		// `none`, which is what the second assertion expects anyway.
		await expect(page.locator('body')).toHaveCSS('--background-invert-if-dark', 'invert(100%)')

		// Read off the painted style: a rule that matched nothing would compute
		// to `none` here, exactly as a picture left alone does.
		const filters = await page.locator('figure[data-component="image-view"] img').evaluateAll((images) => images.map((image) => getComputedStyle(image).filter))
		expect(filters).toEqual(['invert(1) hue-rotate(180deg)', 'none'])
	})

	test('marks the page on contact, on the second stroke as much as the first', async ({ page, request }) => {
		// Every test here drew one unbroken line, and so did every check by
		// hand, which is the shape of drawing that was never broken. Lifting
		// the pen and putting it down again is where the ink used to wait for
		// the browser to report a move before anything appeared under the nib.
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// How much ink is on the sheet the stroke under the pen is drawn on.
		const inkOnSheet = () => canvas.evaluate((element: HTMLCanvasElement) => {
			const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
			let lit = 0
			for (let i = 3; i < pixels.length; i += 4) {
				if (pixels[i] > 0) {
					lit += 1
				}
			}
			return lit
		})

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2

		for (const stroke of [0, 1, 2]) {
			const from = y + stroke * 40
			await page.mouse.move(x, from)
			await page.mouse.down()
			// Nothing has moved yet: the mark must already be there.
			expect(await inkOnSheet(), `stroke ${stroke} left the nib on a blank page`).toBeGreaterThan(0)
			await page.mouse.move(x + 80, from + 30, { steps: 8 })
			await page.mouse.up()
		}

		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(canvas).toBeHidden()

		// All three survived, so lifting between them lost nothing.
		await expect(page.locator('figure[data-component="image-view"]')).toHaveCount(1)
	})

	test('is not text to select, so iOS does not arbitrate every touch', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()

		// A press on the canvas was starting a text selection on iOS: blue
		// handles, the Copy/Look Up callout, and - the part that is felt - the
		// selection gesture recognizer deciding about every touch before the
		// page saw it. touch-action does not stop that; it governs scrolling.
		// Read off the painted style, so a rule that stopped applying fails.
		// -webkit-touch-callout is WebKit's alone and computes to nothing here,
		// so it is not asserted; it was checked on the device this is for, in
		// an iPad simulator, where the callout stopped appearing.
		const style = await canvas.evaluate((element) => {
			const computed = getComputedStyle(element)
			return { select: computed.userSelect, touch: computed.touchAction }
		})
		expect(style.select).toBe('none')
		expect(style.touch).toBe('none')
	})

	test('leaves a control inside the ink to Text', async ({ page, request }) => {
		await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()

		// Text draws a caption field and a delete button inside its image node.
		// Those are Text's: claiming a tap on one opens the canvas instead of
		// doing what the control says.
		const caption = page.locator('figure[data-component="image-view"] input.image__caption__input')
		await expect(caption).toHaveCount(1)
		await caption.click({ force: true })

		await expect(page.locator('.ink__canvas--live')).toBeHidden()
	})

	test('leaves ink-shaped images from elsewhere alone when they are tapped', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		// Named like ink, but one is another note's and one is on another host.
		const noteId = await createNoteViaRequest('', 'Foreign ink', 'Typed already.\n\n![other](.attachments.99999/ink-abc123.png)\n\n![web](https://links.example.test/ink-abc123.png)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const figures = page.locator('figure[data-component="image-view"]')
		await expect(figures).toHaveCount(2)
		await figures.nth(0).click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await figures.nth(1).click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
	})

	test('keeps exactly one tap listener across the editor being closed and reopened', async ({ page, request }) => {
		// Count the live capture-phase click listeners the component registers.
		// A second registration, or one left behind on a closed editor, is what
		// the remove-before-add and the remove-on-destroy are there to prevent.
		await page.addInitScript(() => {
			const live: Array<[EventTarget, unknown]> = []
			const add = EventTarget.prototype.addEventListener
			const remove = EventTarget.prototype.removeEventListener
			const isOurs = (type: string, listener: unknown, options: unknown): boolean => type === 'click'
				&& (options === true || (typeof options === 'object' && options !== null && (options as AddEventListenerOptions).capture === true))
				&& typeof listener === 'function'
				&& listener.name.includes('onEditorClick')
			EventTarget.prototype.addEventListener = function(type: string, listener: any, options?: any) {
				if (isOurs(type, listener, options) && !live.some(([t, l]) => t === this && l === listener)) {
					live.push([this, listener])
				}
				return add.call(this, type, listener, options)
			}
			EventTarget.prototype.removeEventListener = function(type: string, listener: any, options?: any) {
				if (isOurs(type, listener, options)) {
					const at = live.findIndex(([t, l]) => t === this && l === listener)
					if (at !== -1) {
						live.splice(at, 1)
					}
				}
				return remove.call(this, type, listener, options)
			}
			;(window as any).__inkTapListeners = () => live.length
		})

		const noteId = await openInkedNote(page, request)
		const listeners = async (): Promise<number> => await page.evaluate(() => (window as any).__inkTapListeners())
		await expect.poll(listeners).toBe(1)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()

		// The close-and-reopen dance other parts of the app run around a write.
		await page.evaluate((id) => (window as any)._nc_event_bus.emit('notes:editor:close', { noteId: id }), noteId)
		await expect.poll(listeners).toBe(0)
		await page.evaluate((id) => (window as any)._nc_event_bus.emit('notes:editor:reopen', { noteId: id }), noteId)
		await expect.poll(listeners).toBe(1)

		// And the tap still works on the recreated editor.
		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
	})

	test('records a stroke started in the top-left corner of the canvas', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Where the header and the sidebar used to be painted over the canvas.
		const box = (await page.locator('.ink__canvas--live').boundingBox())!
		await page.mouse.move(box.x + 50, box.y + 50)
		await page.mouse.down()
		await page.mouse.move(box.x + 150, box.y + 120, { steps: 10 })
		await page.mouse.up()
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeEnabled()
	})

	test('leaves an ordinary link to the browser, in a new tab', async ({ page, request, context }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		// A host that does not exist, answered locally, so the test needs no network.
		await context.route('https://links.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
		const noteId = await createNoteViaRequest('', 'Linked', '[A web page](https://links.example.test/ordinary-link)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const opened = context.waitForEvent('page')
		await page.getByRole('link', { name: 'A web page' }).click()
		const tab = await opened
		expect(tab.url()).toContain('ordinary-link')
		// The note itself stayed where it was, and no canvas opened.
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		expect(page.url()).toContain(`/apps/notes/note/${noteId}`)
	})

	test('leaves an ink-shaped link on another host to the browser', async ({ page, request, context }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		await context.route('https://links.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
		const noteId = await createNoteViaRequest('', 'Foreign', '[Someone else\'s ink](https://links.example.test/index.php/apps/notes/ink/abc123)\n')
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const opened = context.waitForEvent('page')
		await page.getByRole('link', { name: 'Someone else\'s ink' }).click()
		const tab = await opened
		expect(tab.url()).toBe('https://links.example.test/index.php/apps/notes/ink/abc123')
		// It is another server's ink, not ours: no canvas opens here.
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
	})

	test('says so when the ink a link points at is gone', async ({ page, request }) => {
		/* Deleting the picture leaves the link, because Text will not keep a
		   link attached to an image. Following it must not open a canvas that
		   would write a file the note no longer mentions. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		const path = (await noteContent(noteId)).match(/\.attachments\.\d+\/(ink-[A-Za-z0-9_-]+\.png)/)![0]
		await deleteNoteAttachment(noteId, path)

		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect(page.getByText(/picture for this ink could not be found/i)).toBeVisible()
		// A missing file is not proof of deletion.
		await expect(page.getByText(/no longer|delete the link/i)).toHaveCount(0)
	})

	test('keeps the picture through an edit', async ({ page, request }) => {
		/* Text rewrites the whole note on every save, so the one thing ink
		   leaves behind has to survive being typed around. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()

		// Into the text, not the middle of the editor: the middle of it is the
		// picture that was just drawn, and a click there opens the canvas,
		// which is what a click on ink is meant to do.
		await page.getByText('Typed already.').click()
		await page.keyboard.press('Control+End')
		await page.keyboard.type(' more typing')
		await expect.poll(async () => (await noteContent(noteId)).includes('more typing'), { timeout: 15000 }).toBe(true)

		const after = await noteContent(noteId)
		expect(after).toMatch(/!\[[^\]]*\]\(\.attachments\.\d+\/ink-[A-Za-z0-9_-]+\.png\)/)
		/* And nothing else: the "Edit ink" line that used to follow it never
		   worked, because Text's link bubble claims a click on a link inside
		   the editor. */
		expect(after).not.toMatch(/apps\/notes\/ink\//)
	})

	test('says so when the ink cannot be read at all', async ({ page, request }) => {
		/* Not a 404 - a server that answers badly. loadInk rethrows anything
		   that is not "gone", and nothing awaits openInk, so without a catch
		   this is an unhandled rejection and a canvas that never opens. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		await page.route('**/attachment?*', (route) => route.fulfill({ status: 500 }))
		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect(page.getByText(/could not be opened/i)).toBeVisible()
		// Not told the ink is gone: it may well still be there.
		await expect(page.getByText(/could not be found|no longer/i)).toHaveCount(0)
	})

	test('shows the picture and refuses to replace it when its strokes cannot be read', async ({ page, request }) => {
		/* A preview, or a copy that lost its metadata chunk, is still the only
		   handwriting there is. Done would replace the file by name with a
		   blank page, so the canvas must show it, say so, and not save. */
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toContain('![')

		const path = (await noteContent(noteId)).match(/\.attachments\.\d+\/(ink-[A-Za-z0-9_-]+\.png)/)!
		// A valid one-pixel PNG with no stroke chunk in it.
		const plain = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
		await replaceNoteAttachment(noteId, path[1], plain)

		await page.locator('figure[data-component="image-view"]').click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		await expect(page.locator('.ink__backdrop')).toBeVisible()
		await expect(page.getByText(/strokes of this ink could not be read/i)).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled()

		// Drawing is refused too, so there is nothing to save in the first place.
		const box = (await page.locator('.ink__canvas--live').boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 70, { steps: 5 })
		await page.mouse.up()
		await expect(page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Undo' })).toBeDisabled()

		await page.getByRole('button', { name: 'Cancel' }).click()
		await expect(page.locator('.ink__canvas--live')).toBeHidden()
		expect((await noteAttachment(noteId, path[0])).equals(plain), 'the file on disk is untouched').toBe(true)
	})

	test('crops the picture to the writing, not to the screen', async ({ page, request }) => {
		// A canvas the size of an iPad saved whole is a few words in a field of
		// white space, and the note is then mostly white space.
		const noteId = await openInkedNote(page, request)
		await drawAndFinish(page)

		const image = new RegExp(`(\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)`)
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
		const src = image.exec(await noteContent(noteId))![1]
		const bytes = await noteAttachment(noteId, src)

		// A PNG says its size in IHDR, the first chunk after the signature.
		// Measured in CSS pixels of drawing, which is what the picture is
		// cropped to; the file carries INK_DENSITY pixels for each of them.
		const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		const width = size.getUint32(16) / INK_DENSITY
		const height = size.getUint32(20) / INK_DENSITY
		// drawAndFinish writes one stroke 100 wide and 70 tall, so the picture
		// is about that plus a margin - and nothing like the canvas it was
		// drawn on, which is as wide as the window.
		expect(width).toBeGreaterThanOrEqual(100)
		expect(width).toBeLessThan(200)
		expect(height).toBeGreaterThanOrEqual(70)
		expect(height).toBeLessThan(200)
	})

	test('shows the ink that was just saved, without leaving the note', async ({ page, request }) => {
		// Re-editing writes the file under the name the note already holds, so
		// nothing about the document changes and the browser - asked for a URL
		// it has fetched before - answers out of its cache. The reader was left
		// looking at the picture as it was before they drew on it.
		await openInkedNote(page, request)
		await drawAndFinish(page)

		const figure = page.locator('figure[data-component="image-view"]').first()
		const picture = figure.locator('img')
		await expect(picture).toBeVisible({ timeout: 15000 })
		const before = await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)
		expect(before).toBeGreaterThan(0)

		// Tap the ink to reopen it, and write a good deal wider than before.
		await picture.click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 4
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 400, y + 40, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page.getByRole('dialog', { name: 'Ink' })).toHaveCount(0)

		// The picture on screen is the one that was just saved: wider, because
		// the stroke that was just added is wider.
		await expect
			.poll(async () => await picture.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 })
			.toBeGreaterThan(before + 200)
	})
	test('rubs out the stroke the eraser is dragged across', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Two lines, well apart: one to keep and one to rub out. Drawn from the
		// middle, because the app header and the navigation sidebar are painted
		// over the canvas's top and left edges.
		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 3
		const keep = box.y + box.height / 3
		const rub = keep + 200
		for (const y of [keep, rub]) {
			await page.mouse.move(x, y)
			await page.mouse.down()
			await page.mouse.move(x + 100, y, { steps: 10 })
			await page.mouse.up()
		}

		const eraser = page.getByRole('dialog', { name: 'Ink' }).getByRole('button', { name: 'Erase' })
		await eraser.click()
		await expect(eraser).toHaveAttribute('aria-pressed', 'true')
		await page.mouse.move(x - 10, rub)
		await page.mouse.down()
		await page.mouse.move(x + 110, rub, { steps: 12 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		const image = new RegExp(`(\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)`)
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
		const src = image.exec(await noteContent(noteId))![1]
		const bytes = await noteAttachment(noteId, src)
		const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

		// The picture is cropped to what is left. Both lines would span the 200
		// pixels between them; one line alone is a few pixels tall.
		expect(size.getUint32(20) / INK_DENSITY).toBeLessThan(50)
		// And it is the line that was not rubbed out, not an empty page.
		expect(size.getUint32(16) / INK_DENSITY).toBeGreaterThanOrEqual(100)
	})
	test('reopens on the ink as it was last saved, not as it was first fetched', async ({ page, request }) => {
		// The attachment endpoint answers with `max-age=3600` and no ETag, so a
		// second read of the same path can be served out of the browser's cache
		// for an hour. The picture in the note is refreshed by hand; the file the
		// canvas opens on was not, so re-editing twice showed the drawing as it
		// stood before the first edit.
		await openInkedNote(page, request)
		await drawAndFinish(page)

		const picture = page.locator('figure[data-component="image-view"] img')
		await expect(picture).toBeVisible({ timeout: 15000 })

		// Reopen once, which is what puts the file in the cache, and note how
		// much ink the canvas opened on.
		await picture.click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
		const first = await inkOnThePage(page)
		expect(first).toBeGreaterThan(0)

		// Add a good deal more ink and save it.
		const canvas = page.locator('.ink__canvas--live')
		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 4
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 400, y + 120, { steps: 12 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()
		await expect(page.getByRole('dialog', { name: 'Ink' })).toHaveCount(0)

		// Reopening has to show what was just saved.
		await picture.click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
		await expect.poll(async () => await inkOnThePage(page), { timeout: 10000 }).toBeGreaterThan(first * 1.5)
	})
	test('keeps writing past the bottom of the screen on one page', async ({ page, request }) => {
		const noteId = await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 3
		// Low on the screen, so there is nothing like room for the next line
		// below it without more page.
		const low = box.y + box.height - 40
		const stage = page.locator('.ink__stage')

		// Three lines, each written as low as the one before, with the page
		// moved up in between. A finger does that on the iPad; a wheel here.
		for (const line of [0, 1, 2]) {
			if (line > 0) {
				await page.mouse.move(x, box.y + box.height / 2)
				await page.mouse.wheel(0, box.height)
				await expect(stage).toHaveClass(/ink__stage--above/)
			} else {
				// Nothing is written yet, so there is nowhere to go in either
				// direction.
				await expect(stage).not.toHaveClass(/ink__stage--above/)
				await expect(stage).not.toHaveClass(/ink__stage--below/)
			}
			await page.mouse.move(x, low)
			await page.mouse.down()
			await page.mouse.move(x + 120, low, { steps: 10 })
			await page.mouse.up()
			// Each line leaves page below it to carry on in.
			await expect(stage).toHaveClass(/ink__stage--below/)
		}
		await page.getByRole('button', { name: 'Done' }).click()

		const image = new RegExp(`(\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)`)
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
		const src = image.exec(await noteContent(noteId))![1]
		const bytes = await noteAttachment(noteId, src)
		const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

		// One picture, taller than the screen it was written on: each line is
		// on the page below the one before, not on top of it.
		expect(size.getUint32(20) / INK_DENSITY).toBeGreaterThan(box.height)
		// And no wider than the lines themselves.
		expect(size.getUint32(16) / INK_DENSITY).toBeLessThan(300)
	})
	test('opens the drawing where it was left, every time', async ({ page, request }) => {
		// The file holds the writing cropped to itself. Without the corner it
		// was cropped from, a drawing made in the middle of the page was there
		// the first time it was opened and in the top left corner every time
		// after - which is the kind of thing that reads as unfinished.
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Write in the middle, nowhere near a corner.
		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 90, y + 50, { steps: 10 })
		await page.mouse.up()

		const drawn = await inkBoxOnScreen(page)
		expect(drawn.width).toBeGreaterThan(50)
		// Really in the middle, so a jump to the corner cannot pass unnoticed.
		expect(drawn.left).toBeGreaterThan(200)
		expect(drawn.top).toBeGreaterThan(100)
		await page.getByRole('button', { name: 'Done' }).click()

		const picture = page.locator('figure[data-component="image-view"] img')
		await expect(picture).toBeVisible({ timeout: 15000 })

		// Open it twice: the first open is the one that used to look right.
		for (const visit of ['first', 'second']) {
			await picture.click()
			await expect(page.locator('.ink__canvas--live')).toBeVisible()
			await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
			await expect
				.poll(async () => (await inkBoxOnScreen(page)).width, { timeout: 10000 })
				.toBeGreaterThan(50)

			const again = await inkBoxOnScreen(page)
			expect(Math.abs(again.left - drawn.left), `${visit} open moved it sideways`).toBeLessThan(3)
			expect(Math.abs(again.top - drawn.top), `${visit} open moved it down the page`).toBeLessThan(3)
			await page.getByRole('button', { name: 'Done' }).click()
			await expect(page.getByRole('dialog', { name: 'Ink' })).toHaveCount(0)
		}
	})
	test.describe('on a retina screen', () => {
		test.use({ deviceScaleFactor: 2 })

		test('shows the ink at the size it was drawn, with pixels to spare', async ({ page, request }) => {
			// Markdown cannot say how big to show an image, so a picture is laid
			// out at one image pixel per CSS pixel - and on a 2x screen every
			// pixel of it is then doubled. Cropping the picture to the writing
			// exposed that: the old whole-screen picture was far wider than the
			// column, so the browser shrank it and downsampled, and the ink
			// looked sharper than the screen needed. Ink is saved at a fixed
			// density now and shown at the reciprocal of it.
			const noteId = await openInkedNote(page, request)
			await page.getByRole('button', { name: 'Ink', exact: true }).click()
			const canvas = page.locator('.ink__canvas--live')
			await expect(canvas).toBeVisible()
			await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

			// One stroke, exactly 200 CSS pixels wide.
			const drawn = 200
			const box = (await canvas.boundingBox())!
			const x = box.x + box.width / 4
			const y = box.y + box.height / 3
			await page.mouse.move(x, y)
			await page.mouse.down()
			await page.mouse.move(x + drawn, y + 60, { steps: 20 })
			await page.mouse.up()
			await page.getByRole('button', { name: 'Done' }).click()

			const image = new RegExp(`(\\.attachments\\.${noteId}/ink-[A-Za-z0-9_-]+\\.png)`)
			await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(image)
			const bytes = await noteAttachment(noteId, image.exec(await noteContent(noteId))![1])
			const pixels = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)

			const picture = page.locator('figure[data-component="image-view"] img')
			await expect(picture).toBeVisible({ timeout: 15000 })
			const shown = await picture.evaluate((img: HTMLImageElement) => ({
				css: img.getBoundingClientRect().width,
				dpr: window.devicePixelRatio,
			}))

			// Shown at the size it was written, give or take the crop's margin.
			expect(Math.abs(shown.css - drawn)).toBeLessThan(20)
			// And with at least one image pixel for every pixel of the screen it
			// is shown on, so nothing is being stretched.
			expect(pixels / shown.css).toBeGreaterThanOrEqual(shown.dpr)
		})
	})
	test('keeps the Ink button in the same place however long the note is', async ({ page, request }) => {
		// It used to sit at the foot of a box the height of one screen, so on a
		// long note it rode up the page as the reader scrolled and ended up
		// beside a paragraph in the middle of the text.
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. ` + 'Some text that goes on. '.repeat(6)).join('\n\n')
		const noteId = await createNoteViaRequest('', 'Long', `${long}\n`)
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		const ink = page.getByRole('button', { name: 'Ink', exact: true })
		const where = async () => {
			const box = (await ink.boundingBox())!
			const height = page.viewportSize()!.height
			return { box, onScreen: box.y >= 0 && box.y + box.height <= height }
		}

		const atTop = await where()
		expect(atTop.onScreen, 'not in view before scrolling').toBe(true)

		// All the way down a note far taller than the window.
		await page.locator('.app-content-details').evaluate((el) => {
			el.scrollTop = el.scrollHeight
		})
		await page.waitForTimeout(400)
		const atBottom = await where()
		expect(atBottom.onScreen, 'scrolled out of view').toBe(true)
		// And in the same place on the screen, not merely somewhere on it.
		expect(Math.abs(atBottom.box.y - atTop.box.y), 'moved up the page').toBeLessThan(4)
		expect(Math.abs(atBottom.box.x - atTop.box.x)).toBeLessThan(4)
	})

	test('puts the ink where the caret is', async ({ page, request }) => {
		await login(page)
		await deleteAllNotesVia()
		await setNoteMode(request, 'rich')
		const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n')
		const noteId = await createNoteViaRequest('', 'Caret', `${body}\n`)
		await page.goto(`/index.php/apps/notes/note/${noteId}`)
		await expect(page.locator('.ProseMirror').first()).toBeVisible()

		// The reader puts the caret in the middle of the note and asks for ink.
		await page.getByText('Paragraph 6.', { exact: true }).click()
		await page.keyboard.press('End')
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
		const box = (await canvas.boundingBox())!
		await page.mouse.move(box.x + 300, box.y + 300)
		await page.mouse.down()
		await page.mouse.move(box.x + 380, box.y + 340, { steps: 8 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		// Straight after the paragraph the caret was in, not at the end of the
		// note and not in the title.
		await expect.poll(async () => await noteContent(noteId), { timeout: 15000 }).toMatch(/!\[/)
		const lines = (await noteContent(noteId)).split('\n').filter((line) => line.trim())
		const ink = lines.findIndex((line) => line.startsWith('!['))
		expect(lines[ink - 1]).toBe('Paragraph 6.')
	})

	test('a stroke keeps its color through the file and back', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// Pick red, then draw. The picker names the color it will draw in, so
		// the button is found by what it says rather than by its place. The
		// choices are radio items, so they are not buttons: and "Red" as a
		// button name would also match Text's "Redo".
		await page.getByRole('button', { name: /^Color:/ }).click()
		await page.getByRole('menuitemradio', { name: 'Red', exact: true }).click()

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 100, y + 70, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		// The picture in the note, before it is opened: this is the file as
		// every other client will show it.
		const picture = page.locator('figure[data-component="image-view"] img').first()
		await expect(picture).toBeVisible()
		const fileColors = await inkColorsInTheNoteImage(picture)
		// Said separately, so a thinner nib fails as "no opaque pixels" and not as
		// a wrong color.
		expect(fileColors.length, 'no fully-opaque pixels in the saved PNG').toBeGreaterThan(0)
		expect(fileColors).toContain('#cc0000')

		// Reopen the drawing and read what is on the page sheet.
		await picture.click()
		await expect(page.locator('.ink__canvas--page')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		const colors = await inkColorsOnThePage(page)
		// Said separately, so a reader of a failure can tell "the ink is the
		// wrong color" from "the helper found no fully-opaque pixels at all",
		// which is what a thinner nib would cause.
		expect(colors.length).toBeGreaterThan(0)
		expect(colors).toContain('#cc0000')

		// And the picker opens on the color last used, not back at black.
		await expect(page.getByRole('button', { name: 'Color: Red' })).toBeVisible()
	})

	test('keeps the hue of colored ink when the theme inverts it', async ({ page, request }) => {
		// The whole color design rests on this one declaration. Plain invert
		// flips lightness and hue together, which turns a red annotation cyan;
		// the hue-rotate puts the hue back. A mistake here is invisible in the
		// light theme, which is how the tests run by default.
		await openInkedNote(page, request)
		await drawAndFinish(page)

		const picture = page.locator('figure[data-component="image-view"] img').first()
		await expect(picture).toBeVisible()

		await putPageOnTheme(page, 'light')
		const filter = await picture.evaluate((img) => getComputedStyle(img).filter)
		// The light theme applies none: `no hue-rotate(180deg)` is not a valid
		// filter, so the declaration is dropped entirely.
		expect(filter).toBe('none')

		// And on the dark theme the pair is applied. Swap the attribute the
		// theming app sets, rather than changing the account's theme, so the
		// test says what the CSS does and nothing about the server.
		//
		// The light attribute has to come OFF, not merely be joined by the dark
		// one. Every theme's stylesheet is linked on every page so the theme can
		// be switched without a reload, and `[data-theme-light]` and
		// `[data-theme-dark]` have equal specificity - so with both attributes
		// present, source order decides and light.css is linked last. Measured:
		// adding `data-theme-dark` alone leaves the variable at `no`.
		await putPageOnTheme(page, 'dark')
		const dark = await picture.evaluate((img) => getComputedStyle(img).filter)
		expect(dark).toBe('invert(1) hue-rotate(180deg)')
	})

	test('keeps the hue of the ink on every surface that shows it', async ({ page, request }) => {
		// The picture in the note is checked above. The other two surfaces are
		// the canvas the ink is written on and the picker's swatches, and a
		// swatch or canvas left on plain invert would look right in every
		// light-theme test while the picker promised a color the page does not
		// give.
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		await expect(page.locator('.ink__canvas--live')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// The trigger's own swatch: it is in the bar whether or not the menu is
		// open, and shows the color in use. Said by count first, so a selector
		// that matched nothing fails here instead of passing vacuously below.
		const trigger = page.locator('.ink__color .ink__swatch')
		await expect(trigger).toHaveCount(1)
		// The menu is teleported out of the bar, so its swatches are found from
		// the page; opening it also puts the six choices' swatches in reach.
		await page.getByRole('button', { name: /^Color:/ }).click()
		await expect(page.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeVisible()
		const choice = page.getByRole('menuitemradio', { name: 'Red', exact: true }).locator('.ink__swatch')
		await expect(choice).toHaveCount(1)
		await page.keyboard.press('Escape')
		await expect(page.getByRole('menuitemradio', { name: 'Red', exact: true })).toBeHidden()

		const surfaces = {
			canvas: page.locator('.ink__canvas--live'),
			trigger,
		}

		const filterOf = async (locator: typeof trigger) => await locator.evaluate((el) => getComputedStyle(el).filter)
		// The painted box, not the declared width and height: an element that is
		// hidden or collapsed to nothing still reports the size it was given, and
		// has no box to show anything with. A swatch paints its color only inside
		// a box of some size, so the box has to be at least the 16px it is given.
		// The box is measured with `at least` because the border is drawn outside
		// that size, which makes it a little larger than 16. This establishes
		// that the swatch is shown with a box; a swatch cut off by an ancestor's
		// overflow keeps its full box, so clipping is not something it detects.
		const expectSwatchBox = async (locator: typeof trigger, name: string) => {
			const box = await locator.boundingBox()
			expect(box, name).not.toBeNull()
			expect(box!.width, name).toBeGreaterThanOrEqual(16)
			expect(box!.height, name).toBeGreaterThanOrEqual(16)
		}

		// The trigger is the only thing in the bar that shows the color in use.
		await expect(trigger, 'trigger swatch').toBeVisible()
		await expectSwatchBox(trigger, 'trigger swatch')

		// The light theme applies no filter at all.
		await putPageOnTheme(page, 'light')
		for (const [name, locator] of Object.entries(surfaces)) {
			expect(await filterOf(locator), name).toBe('none')
		}

		// The light attribute has to come OFF, not merely be joined by the dark
		// one. Every theme's stylesheet is linked on every page so the theme can
		// be switched without a reload, and `[data-theme-light]` and
		// `[data-theme-dark]` have equal specificity - so with both attributes
		// present, source order decides and light.css is linked last.
		await putPageOnTheme(page, 'dark')
		for (const [name, locator] of Object.entries(surfaces)) {
			expect(await filterOf(locator), name).toBe('invert(1) hue-rotate(180deg)')
		}

		// A swatch in the menu, which is a separate element from the trigger's.
		await page.getByRole('button', { name: /^Color:/ }).click()
		await expect(choice).toBeVisible()
		expect(await filterOf(choice), 'menu swatch').toBe('invert(1) hue-rotate(180deg)')
		await expectSwatchBox(choice, 'menu swatch')
	})

	test('a rectangle survives the picture and the reopen', async ({ page, request }) => {
		await openInkedNote(page, request)
		await page.getByRole('button', { name: 'Ink', exact: true }).click()
		const canvas = page.locator('.ink__canvas--live')
		await expect(canvas).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// The tool names itself on its button, so it is found by what it says.
		await page.getByRole('button', { name: /^Tool:/ }).click()
		await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Tool: Rectangle' })).toBeVisible()

		const box = (await canvas.boundingBox())!
		const x = box.x + box.width / 2 - 100
		const y = box.y + box.height / 2 - 60
		await page.mouse.move(x, y)
		await page.mouse.down()
		await page.mouse.move(x + 200, y + 120, { steps: 10 })
		await page.mouse.up()
		await page.getByRole('button', { name: 'Done' }).click()

		// Reopen and measure what came back.
		await expect(page.locator('figure[data-component="image-view"] img').first()).toBeVisible()
		await page.locator('figure[data-component="image-view"] img').first().click()
		await expect(page.locator('.ink__canvas--page')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()

		// A rectangle is its outline: ink along the edges and none through the
		// middle. Reading the pixels rather than the strokes is what makes this
		// about the drawing rather than about the metadata.
		const painted = await inkOnThePage(page)
		expect(painted).toBeGreaterThan(0)
		const shape = await inkBoxOnScreen(page)
		// Drawn 200x120 and saved at INK_DENSITY; the page sheet is at the
		// device ratio, so compare proportions rather than absolute sizes.
		expect(shape.width / shape.height).toBeGreaterThan(1.4)
		expect(shape.width / shape.height).toBeLessThan(1.9)

		const measured = await page.locator('.ink__canvas--page').evaluate((element: HTMLCanvasElement) => {
			const context = element.getContext('2d')!
			const { data, width } = context.getImageData(0, 0, element.width, element.height)
			// The page sheet is the size of the page and the shape sits somewhere
			// on it, so everything below is taken of the box the ink occupies, not
			// of the sheet.
			let left = Infinity
			let top = Infinity
			let right = -Infinity
			let bottom = -Infinity
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] !== 0) {
					const at = (i - 3) / 4
					left = Math.min(left, at % width)
					right = Math.max(right, at % width)
					top = Math.min(top, Math.floor(at / width))
					bottom = Math.max(bottom, Math.floor(at / width))
				}
			}
			const third = (bottom - top) / 3
			// A square a tenth of the box on a side, at each corner of the box.
			const reach = { x: (right - left) / 10, y: (bottom - top) / 10 }
			const corners = [0, 0, 0, 0]
			let edge = 0
			let middle = 0
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] === 0) {
					continue
				}
				const at = (i - 3) / 4
				const x = at % width
				const y = Math.floor(at / width)
				// Count ink in the middle third of the painted rows against ink
				// anywhere. A filled shape would put plenty in the middle.
				if (y > top + third && y < bottom - third) {
					middle++
				}
				edge++
				const nearLeft = x < left + reach.x
				const nearRight = x > right - reach.x
				const nearTop = y < top + reach.y
				const nearBottom = y > bottom - reach.y
				corners[0] += nearLeft && nearTop ? 1 : 0
				corners[1] += nearRight && nearTop ? 1 : 0
				corners[2] += nearLeft && nearBottom ? 1 : 0
				corners[3] += nearRight && nearBottom ? 1 : 0
			}
			return { edge, middle, corners }
		})
		expect(measured.edge).toBeGreaterThan(0)
		// The sides still cross the middle third, so this is a ratio and not a
		// zero: a filled rectangle would put far more there than its two sides.
		expect(measured.middle / measured.edge).toBeLessThan(0.35)
		// An ellipse is an outline too, so hollow does not make it a rectangle.
		// What does is the corners: a rectangle's sides meet at the corners of
		// its box, while an ellipse curves away from every one of them.
		for (const corner of measured.corners) {
			expect(corner).toBeGreaterThan(0)
		}

		// And the tool opens on the pen next time, unlike the color.
		await expect(page.getByRole('button', { name: 'Tool: Pen' })).toBeVisible()
	})
})
