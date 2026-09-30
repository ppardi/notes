/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { INK_FILE_PATTERN, inkAttachmentPath, inkFileName, inkIdFromUrl, inkLinkUrl, inkMarkdown, makeInkId } from '../inkLink.js'

beforeAll(() => {
	globalThis.t = (app, text, params) => Object.entries(params ?? {})
		.reduce((out, [key, value]) => out.replace(`{${key}}`, value), text)
})

describe('ink names', () => {
	it('names the file after the id', () => {
		expect(inkFileName('abc123')).toBe('ink-abc123.png')
	})

	it('puts it in the note\'s own attachment folder', () => {
		expect(inkAttachmentPath(85110, 'abc123')).toBe('.attachments.85110/ink-abc123.png')
	})

	it('makes an id a file name and a URL both accept', () => {
		expect(makeInkId()).toMatch(/^[A-Za-z0-9_-]+$/)
	})
})

describe('ink links', () => {
	it('reads the id back out of its own URL', () => {
		expect(inkIdFromUrl(inkLinkUrl('abc123'))).toBe('abc123')
	})

	it('reads the id out of an absolute URL', () => {
		/* openLinkHandler is handed the resolved href, not the relative path
		   the document holds, so matching the whole string would never fire. */
		expect(inkIdFromUrl('http://localhost:8089/index.php/apps/notes/ink/abc123')).toBe('abc123')
	})

	it('does not claim links that are not ours', () => {
		expect(inkIdFromUrl('https://example.com/apps/files/ink/abc')).toBeNull()
		expect(inkIdFromUrl('/index.php/apps/notes/note/85110')).toBeNull()
		expect(inkIdFromUrl('#h-heading')).toBeNull()
		expect(inkIdFromUrl('')).toBeNull()
	})

	it('refuses an id that is not one of ours', () => {
		/* The id lands in a file name. Anything outside the id alphabet is a
		   path the note should not be able to ask for. */
		expect(inkIdFromUrl('/index.php/apps/notes/ink/../../etc/passwd')).toBeNull()
	})
})

describe('what goes into the note', () => {
	it('writes the image and its link as separate blocks', () => {
		/* Text discards a link wrapped around an image, in the DOM and out of
		   the markdown on the first save. Two blocks is what survives. */
		const markdown = inkMarkdown(85110, 'abc123')
		expect(markdown).toContain('![')
		expect(markdown).toContain('.attachments.85110/ink-abc123.png')
		expect(markdown).toContain('](')
		expect(markdown.split('\n\n').length).toBeGreaterThanOrEqual(2)
		expect(markdown).not.toMatch(/\[!\[[^\]]*\]\([^)]*\)\]\(/)
	})
})

describe('ink file pattern', () => {
	it('matches ink files from a rendered src', () => {
		expect('.attachments.85110/ink-abc123.png').toMatch(INK_FILE_PATTERN)
		const match = '.attachments.85110/ink-abc123.png'.match(INK_FILE_PATTERN)
		expect(match?.[1]).toBe('abc123')
	})

	it('does not match non-ink files', () => {
		expect('.attachments.85110/holiday.png').not.toMatch(INK_FILE_PATTERN)
	})

	it('does not match ink files with empty ids', () => {
		expect('ink-.png').not.toMatch(INK_FILE_PATTERN)
	})
})
