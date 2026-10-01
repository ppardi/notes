/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { refreshInkPicture } from '../inkRefresh.js'

/* What Text renders an attachment as: the figure carries the path the note
   holds, and the picture inside is fetched from Text's own endpoint with a
   session token that must survive untouched. */
const TOKEN = 'bIRr0ynwXbDrSgkGtTk2IRxenpN2XZvLoXs%2BzvXL4GXBrezIMtPWxYwMbAnHAiVW'
const SRC = `/index.php/apps/text/image?documentId=5&sessionId=20&sessionToken=${TOKEN}&imageFileName=ink-abc.png`

let root

beforeEach(() => {
	root = document.createElement('div')
	root.innerHTML = `
		<figure data-component="image-view" data-src=".attachments.5/ink-abc.png">
			<button class="media-wrapper"><img src="${SRC}"></button>
		</figure>
		<figure data-component="image-view" data-src=".attachments.5/ink-other.png">
			<button class="media-wrapper"><img src="/index.php/apps/text/image?imageFileName=ink-other.png"></button>
		</figure>
		<figure data-component="image-view" data-src=".attachments.5/holiday.png">
			<button class="media-wrapper"><img src="/index.php/apps/text/image?imageFileName=holiday.png"></button>
		</figure>`
	document.body.append(root)
})

describe('refreshInkPicture', () => {
	it('makes the browser fetch the picture again', () => {
		/* Re-editing writes the file under the name the note already holds, so
		   nothing in the document changes, Text has no reason to render the
		   image again, and the browser answers from its cache. Without this
		   the reader is looking at the ink as it was before they drew on it. */
		expect(refreshInkPicture(root, 5, 'abc')).toBe(1)
		const after = root.querySelector('img').getAttribute('src')
		expect(after).not.toBe(SRC)
		expect(after.startsWith(`${SRC}&`)).toBe(true)
	})

	it('keeps the session token exactly as it was', () => {
		/* Reassembling the query would re-encode it, and the token is what
		   Text checks before it hands the file over. */
		refreshInkPicture(root, 5, 'abc')
		expect(root.querySelector('img').getAttribute('src')).toContain(`sessionToken=${TOKEN}`)
	})

	it('leaves every other picture in the note alone', () => {
		refreshInkPicture(root, 5, 'abc')
		const others = [...root.querySelectorAll('img')].slice(1)
		expect(others.map((img) => img.getAttribute('src'))).toEqual([
			'/index.php/apps/text/image?imageFileName=ink-other.png',
			'/index.php/apps/text/image?imageFileName=holiday.png',
		])
	})

	it('does not grow the URL a parameter at a time', () => {
		/* A reader can edit the same ink all afternoon. */
		refreshInkPicture(root, 5, 'abc', 1)
		refreshInkPicture(root, 5, 'abc', 2)
		refreshInkPicture(root, 5, 'abc', 3)
		const src = root.querySelector('img').getAttribute('src')
		expect(src.match(/inkedat=/g)).toHaveLength(1)
		expect(src).toBe(`${SRC}&inkedat=3`)
	})

	it('refreshes a picture whose URL carries no query at all', () => {
		root.querySelector('img').setAttribute('src', '/remote.php/dav/ink-abc.png')
		refreshInkPicture(root, 5, 'abc', 7)
		expect(root.querySelector('img').getAttribute('src')).toBe('/remote.php/dav/ink-abc.png?inkedat=7')
	})

	it('says it found nothing rather than throwing when the ink is not on screen', () => {
		expect(refreshInkPicture(root, 5, 'missing')).toBe(0)
		expect(refreshInkPicture(null, 5, 'abc')).toBe(0)
	})
})
