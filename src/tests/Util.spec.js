/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
	categoryFromQuery,
	categoryFromSetting,
	categoryLabel,
	categoryRoute,
	categoryToQuery,
	categoryToSetting,
	copyNote,
	escapeHtml,
	getDefaultSampleNote,
	getDefaultSampleNoteTitle,
	getDraggedCategory,
	getDraggedNoteId,
	isCategoryDrag,
	isInCategory,
	isNoteDrag,
	keepCategory,
	noteAttributes,
	routeIsNewNote,
} from '../Util.js'

const NOTE_ID_TYPE = 'application/x-nextcloud-notes-note-id'

/**
 * A drag event carrying the given data, as the browser would report it.
 *
 * @param {object} data mime type to payload
 * @param {Array<string>} [types] types to advertise, defaults to the data's keys
 * @return {object} something shaped like a DragEvent
 */
function dragEvent(data, types = Object.keys(data)) {
	return {
		dataTransfer: {
			types,
			getData: (type) => data[type] ?? '',
		},
	}
}

beforeAll(() => {
	// main.js hands the components t() from core's globals
	vi.stubGlobal('t', (app, text) => text)
})

describe('copyNote', () => {
	it('copies every note attribute', () => {
		const from = Object.fromEntries(noteAttributes.map((attr) => [attr, attr]))

		expect(copyNote(from, {})).toEqual(from)
	})

	it('leaves out what it is told to exclude', () => {
		const from = { id: 1, title: 'a', content: 'b' }

		expect(copyNote(from, {}, ['content'])).toStrictEqual({
			id: 1,
			title: 'a',
			etag: undefined,
			modified: undefined,
			favorite: undefined,
			category: undefined,
		})
	})

	it('returns the target it was given', () => {
		const to = {}

		expect(copyNote({ id: 1 }, to)).toBe(to)
	})
})

describe('categoryLabel', () => {
	it('names the empty category', () => {
		expect(categoryLabel('')).toBe('Unfiled')
	})

	it('spaces out the separators of a nested category', () => {
		expect(categoryLabel('a/b/c')).toBe('a / b / c')
	})

	it('leaves a plain category alone', () => {
		expect(categoryLabel('Recipes')).toBe('Recipes')
	})
})

describe('isInCategory', () => {
	it('matches a note in the selected category itself', () => {
		expect(isInCategory('Work', 'Work')).toBe(true)
	})

	it('does not match a note in a descendant of the selected category', () => {
		expect(isInCategory('Work/Projects/2026', 'Work/Projects')).toBe(false)
	})

	it('does not match a note in a child of the selected category', () => {
		expect(isInCategory('Work/Projects', 'Work')).toBe(false)
	})

	it('matches a note whose nested category is selected exactly', () => {
		expect(isInCategory('Personal/Work', 'Personal/Work')).toBe(true)
	})

	it('does not match a sibling category sharing a name prefix', () => {
		expect(isInCategory('Workshop', 'Work')).toBe(false)
	})

	it('matches every note when no category is selected', () => {
		expect(isInCategory('Work/Projects', null)).toBe(true)
		expect(isInCategory('', null)).toBe(true)
	})

	it('matches only uncategorized notes for the uncategorized selection', () => {
		expect(isInCategory('', '')).toBe(true)
		expect(isInCategory('Work', '')).toBe(false)
	})
})

describe('categoryToQuery', () => {
	it('drops the parameter for the all-notes selection', () => {
		expect(categoryToQuery(null)).toEqual({ category: undefined })
	})

	it('keeps an empty parameter for the uncategorized selection', () => {
		expect(categoryToQuery('')).toEqual({ category: '' })
	})

	it('carries a nested category as its full path', () => {
		expect(categoryToQuery('Work/Projects')).toEqual({ category: 'Work/Projects' })
	})
})

describe('categoryFromQuery', () => {
	it('reads a missing parameter as the all-notes selection', () => {
		expect(categoryFromQuery({})).toBe(null)
	})

	it('reads an empty parameter as the uncategorized selection', () => {
		expect(categoryFromQuery({ category: '' })).toBe('')
	})

	it('reads a nested category back unchanged', () => {
		expect(categoryFromQuery({ category: 'Work/Projects' })).toBe('Work/Projects')
	})

	it('takes the first value when the parameter is repeated', () => {
		expect(categoryFromQuery({ category: ['Work', 'Personal'] })).toBe('Work')
	})

	it('reads a missing query as the all-notes selection', () => {
		expect(categoryFromQuery(undefined)).toBe(null)
	})
})

describe('categoryRoute', () => {
	it('selects a category without disturbing the rest of the query', () => {
		expect(categoryRoute({ query: { new: null } }, 'Work'))
			.toEqual({ query: { new: null, category: 'Work' } })
	})

	it('clears the category for the all-notes selection', () => {
		expect(categoryRoute({ query: { category: 'Work' } }, null))
			.toEqual({ query: { category: undefined } })
	})

	it('replaces a category that is already selected', () => {
		expect(categoryRoute({ query: { category: 'Work' } }, 'Personal/Work'))
			.toEqual({ query: { category: 'Personal/Work' } })
	})

	it('copes with a route that carries no query', () => {
		expect(categoryRoute({}, 'Work')).toEqual({ query: { category: 'Work' } })
	})
})

describe('keepCategory', () => {
	it('carries the selected category into another route', () => {
		expect(keepCategory({ query: { category: 'Work' } }, { new: null }))
			.toEqual({ new: null, category: 'Work' })
	})

	it('carries the uncategorized selection', () => {
		expect(keepCategory({ query: { category: '' } }, {})).toEqual({ category: '' })
	})

	it('leaves the all-notes selection unset', () => {
		expect(keepCategory({ query: {} }, { new: null }))
			.toEqual({ new: null, category: undefined })
	})

	it('does not carry unrelated query fields across', () => {
		expect(keepCategory({ query: { category: 'Work', new: null } }, {}))
			.toEqual({ category: 'Work' })
	})

	it('copes with no target query at all', () => {
		expect(keepCategory({ query: { category: 'Work' } })).toEqual({ category: 'Work' })
	})
})

describe('categoryToSetting', () => {
	it('stores the all-notes selection', () => {
		expect(categoryToSetting(null)).toBe('all')
	})

	it('stores the uncategorized selection distinctly from all notes', () => {
		expect(categoryToSetting('')).toBe('category:')
	})

	it('stores a nested category', () => {
		expect(categoryToSetting('Personal/Work')).toBe('category:Personal/Work')
	})
})

describe('categoryFromSetting', () => {
	it('reads the all-notes selection back', () => {
		expect(categoryFromSetting('all')).toBe(null)
	})

	it('reads the uncategorized selection back', () => {
		expect(categoryFromSetting('category:')).toBe('')
	})

	it('reads a nested category back', () => {
		expect(categoryFromSetting('category:Personal/Work')).toBe('Personal/Work')
	})

	it('treats an unset or unknown value as all notes', () => {
		expect(categoryFromSetting('')).toBe(null)
		expect(categoryFromSetting(undefined)).toBe(null)
		expect(categoryFromSetting('nonsense')).toBe(null)
	})

	it('round-trips every selection', () => {
		for (const category of [null, '', 'Work', 'Personal/Work/2026']) {
			expect(categoryFromSetting(categoryToSetting(category))).toBe(category)
		}
	})
})

describe('routeIsNewNote', () => {
	it.each([
		['the query carries new', { query: { new: null } }, true],
		['the query carries other keys', { query: { other: '1' } }, false],
		['the query is empty', { query: {} }, false],
	])('is %s', (_label, route, expected) => {
		expect(routeIsNewNote(route)).toBe(expected)
	})
})

describe('isNoteDrag', () => {
	it('recognises the note id type', () => {
		expect(isNoteDrag(dragEvent({ [NOTE_ID_TYPE]: '7' }))).toBe(true)
	})

	it('takes a bare note id as a note', () => {
		expect(isNoteDrag(dragEvent({ 'text/plain': ' 7 ' }))).toBe(true)
	})

	it.each([
		['there is no data transfer', {}],
		['the transfer advertises no types', { dataTransfer: { getData: () => '' } }],
		['a link is dragged', dragEvent({ 'text/uri-list': 'https://example.com' })],
		['the text is not a note id', dragEvent({ 'text/plain': 'some words' })],
	])('says no when %s', (_label, event) => {
		expect(isNoteDrag(event)).toBe(false)
	})

	it('says no when the browser refuses the data', () => {
		const event = dragEvent({ 'text/plain': '7' })
		event.dataTransfer.getData = () => {
			throw new Error('not allowed')
		}

		expect(isNoteDrag(event)).toBe(false)
	})
})

describe('getDraggedNoteId', () => {
	const writableNote = () => ({ readonly: false })

	it('reads the id from the note id type', () => {
		expect(getDraggedNoteId(dragEvent({ [NOTE_ID_TYPE]: '7' }), writableNote)).toBe(7)
	})

	it('falls back to the plain text id', () => {
		expect(getDraggedNoteId(dragEvent({ 'text/plain': '7' }), writableNote)).toBe(7)
	})

	it('falls back to the plain text id when the browser refuses the custom type', () => {
		const event = dragEvent({ 'text/plain': '7' }, [NOTE_ID_TYPE, 'text/plain'])
		const getData = event.dataTransfer.getData
		event.dataTransfer.getData = (type) => {
			if (type === NOTE_ID_TYPE) {
				throw new Error('not allowed')
			}
			return getData(type)
		}

		expect(getDraggedNoteId(event, writableNote)).toBe(7)
	})

	it('drops the drag when the browser refuses the plain text too', () => {
		const event = dragEvent({}, ['text/plain'])
		event.dataTransfer.getData = () => {
			throw new Error('not allowed')
		}

		expect(getDraggedNoteId(event, writableNote)).toBeNull()
	})

	it('asks about the note it read', () => {
		const getNoteById = vi.fn(writableNote)

		getDraggedNoteId(dragEvent({ [NOTE_ID_TYPE]: '7' }), getNoteById)

		expect(getNoteById).toHaveBeenCalledWith(7)
	})

	it.each([
		['there is no data transfer', {}, writableNote],
		['the transfer advertises no types', { dataTransfer: { getData: () => '' } }, writableNote],
		['a link is dragged', dragEvent({ 'text/uri-list': 'https://example.com' }), writableNote],
		['the id is not a number', dragEvent({ [NOTE_ID_TYPE]: 'seven' }), writableNote],
		['the note is unknown', dragEvent({ [NOTE_ID_TYPE]: '7' }), () => null],
		['the note is read-only', dragEvent({ [NOTE_ID_TYPE]: '7' }), () => ({ readonly: true })],
		['no lookup was given', dragEvent({ [NOTE_ID_TYPE]: '7' }), undefined],
	])('drops the drag when %s', (_label, event, getNoteById) => {
		expect(getDraggedNoteId(event, getNoteById)).toBeNull()
	})
})

describe('getDefaultSampleNote', () => {
	it('opens with the sample note title as a heading', () => {
		expect(getDefaultSampleNote()).toMatch(new RegExp(`^# ${getDefaultSampleNoteTitle()}\n`))
	})

	it('carries the task list the sample is meant to show off', () => {
		expect(getDefaultSampleNote()).toContain('* [ ] ')
	})
})

describe('escapeHtml', () => {
	it.each([
		['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
		['a & b', 'a &amp; b'],
		['plain text', 'plain text'],
	])('escapes %j', (input, expected) => {
		expect(escapeHtml(input)).toBe(expected)
	})
})

describe('isCategoryDrag', () => {
	it('recognises a dragged category', () => {
		expect(isCategoryDrag(dragEvent({ 'application/x-nextcloud-notes-category': 'Work' }))).toBe(true)
	})

	it('recognises the uncategorized category, which is an empty string', () => {
		expect(isCategoryDrag(dragEvent({ 'application/x-nextcloud-notes-category': '' }))).toBe(true)
	})

	it('does not mistake a dragged note for a category', () => {
		expect(isCategoryDrag(dragEvent({ [NOTE_ID_TYPE]: '7' }))).toBe(false)
	})

	it('copes with no drag data at all', () => {
		expect(isCategoryDrag(undefined)).toBe(false)
		expect(isCategoryDrag({})).toBe(false)
	})
})

describe('getDraggedCategory', () => {
	it('reads the dragged category back', () => {
		expect(getDraggedCategory(dragEvent({ 'application/x-nextcloud-notes-category': 'Work/Projects' })))
			.toBe('Work/Projects')
	})

	it('has nothing for a drag that carries no category', () => {
		expect(getDraggedCategory(dragEvent({ [NOTE_ID_TYPE]: '7' }))).toBe(null)
		expect(getDraggedCategory(undefined)).toBe(null)
	})
})
