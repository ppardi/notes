/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest'
import { inkIdFromNode } from '../inkTap.js'

/**
 * @param {string} src what Text put in data-src
 * @return {Element} a figure shaped like Text's image node
 */
function figure(src) {
	const el = document.createElement('figure')
	el.setAttribute('data-component', 'image-view')
	el.setAttribute('data-src', src)
	const inner = document.createElement('span')
	el.append(inner)
	document.body.append(el)
	return inner
}

describe('inkIdFromNode', () => {
	it('finds the ink a tap landed in', () => {
		expect(inkIdFromNode(figure('.attachments.85110/ink-abc123.png'), 85110)).toBe('abc123')
	})

	it('ignores an ordinary image', () => {
		/* Tapping a photo must still do what Text does with a photo. */
		expect(inkIdFromNode(figure('.attachments.85110/holiday.png'), 85110)).toBeNull()
	})

	it('ignores a tap outside any image', () => {
		expect(inkIdFromNode(document.createElement('p'), 85110)).toBeNull()
		expect(inkIdFromNode(null, 85110)).toBeNull()
	})

	it('does not claim a name that only looks like ink', () => {
		expect(inkIdFromNode(figure('.attachments.85110/ink-.png'), 85110)).toBeNull()
		expect(inkIdFromNode(figure('.attachments.85110/ink-a b.png'), 85110)).toBeNull()
	})

	it('does not claim an external image with an ink-shaped name', () => {
		expect(inkIdFromNode(figure('https://elsewhere.example/ink-abc123.png'), 85110)).toBeNull()
		expect(inkIdFromNode(figure('https://elsewhere.example/.attachments.85110/ink-abc123.png'), 85110)).toBeNull()
	})

	it('does not claim ink that sits in another note\'s attachment folder', () => {
		expect(inkIdFromNode(figure('.attachments.99999/ink-abc123.png'), 85110)).toBeNull()
	})

	it('accepts the note id as a string, as a route gives it', () => {
		expect(inkIdFromNode(figure('.attachments.85110/ink-abc123.png'), '85110')).toBe('abc123')
	})
})

describe('a click on a control inside the ink', () => {
	/* Text draws its own controls inside the image node - a delete button, a
	   caption field. Those belong to Text. Claiming them opens the canvas
	   instead of doing what the button says. */
	function figureWith(inner) {
		document.body.innerHTML = `<figure data-component="image-view" data-src=".attachments.5/ink-abc.png">${inner}</figure>`
		return document.body.firstElementChild
	}

	it('is not ink', () => {
		const figure = figureWith('<img><button class="delete">x</button>')
		expect(inkIdFromNode(figure.querySelector('.delete'), 5)).toBeNull()
	})

	it('is not ink when the click lands inside the control', () => {
		const figure = figureWith('<img><button class="delete"><span class="icon"></span></button>')
		expect(inkIdFromNode(figure.querySelector('.icon'), 5)).toBeNull()
	})

	it('is not ink for a caption being typed in', () => {
		const figure = figureWith('<img><input class="caption">')
		expect(inkIdFromNode(figure.querySelector('.caption'), 5)).toBeNull()
	})

	it('is still ink when Text wraps the picture in a button of its own', () => {
		/* Text puts the picture inside a button labeled "Open image". That
		   button is the picture, not a control beside it, and a tap on it is
		   the tap this whole feature is for. */
		const figure = figureWith('<button class="media-wrapper"><img></button><button class="delete">x</button>')
		expect(inkIdFromNode(figure.querySelector('img'), 5)).toBe('abc')
		expect(inkIdFromNode(figure.querySelector('.media-wrapper'), 5)).toBe('abc')
		expect(inkIdFromNode(figure.querySelector('.delete'), 5)).toBeNull()
	})

	it('is still ink on the picture itself', () => {
		const figure = figureWith('<img><button class="delete">x</button>')
		expect(inkIdFromNode(figure.querySelector('img'), 5)).toBe('abc')
	})
})
