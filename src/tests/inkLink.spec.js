/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, it } from 'vitest'
import * as inkLink from '../inkLink.js'
import { INK_FILE_PATTERN, inkAttachmentPath, inkContent, inkFileName, inkIdFromUrl, inkLinkUrl, makeInkId } from '../inkLink.js'

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

	it('guards against encoded traversal in the id', () => {
		/* The ID.test(id) guard must reject ids that decode to path traversal
		   or other invalid characters. */
		expect(inkIdFromUrl('/index.php/apps/notes/ink/..%2F..%2Fetc%2Fpasswd')).toBeNull()
		expect(inkIdFromUrl('/index.php/apps/notes/ink/%2e%2e')).toBeNull()
		expect(inkIdFromUrl('/index.php/apps/notes/ink/abc%00def')).toBeNull()
	})

	it('handles malformed URL encoding gracefully', () => {
		/* Malformed escape sequences that cause decodeURIComponent to throw
		   must return null, not propagate the exception. */
		expect(inkIdFromUrl('/index.php/apps/notes/ink/%')).toBeNull()
		expect(inkIdFromUrl('/index.php/apps/notes/ink/%E0%A4%A')).toBeNull()
	})
})

describe('what the module offers', () => {
	it('has one way to put ink in a note, and it is nodes rather than a string', () => {
		/* A markdown string handed to the editor lands as escaped literal text,
		   so a helper that builds one is a trap, not an option. */
		expect(Object.keys(inkLink).sort()).toEqual([
			'INK_FILE_PATTERN',
			'inkAttachmentPath',
			'inkContent',
			'inkFileName',
			'inkIdFromUrl',
			'inkLinkUrl',
			'makeInkId',
		])
	})
})

describe('what goes into the editor', () => {
	it('is an image block and a separate paragraph holding the link', () => {
		const [image, paragraph] = inkContent(85110, 'abc123')
		expect(image.type).toBe('image')
		expect(image.attrs.src).toBe('.attachments.85110/ink-abc123.png')
		expect(paragraph.type).toBe('paragraph')
		expect(paragraph.content[0].marks[0].attrs.href).toBe(inkLinkUrl('abc123'))
		/* The link is never a mark on the image: Text would discard it. */
		expect(image.marks).toBeUndefined()
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
