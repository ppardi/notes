/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../stores/app.js'
import { useNotesStore } from '../stores/notes.js'

describe('notes store updateNote', () => {
	let store

	beforeEach(() => {
		setActivePinia(createPinia())
		store = useNotesStore()
		store.updateNote({
			id: 1,
			title: 'A note',
			category: '',
			internalPath: '/Notes/A note.md',
			readonly: false,
		})
	})

	it('takes the path a moved note reports', () => {
		store.updateNote({ id: 1, category: 'Work', internalPath: '/Notes/Work/A note.md' })

		expect(store.getNote(1).internalPath).toBe('/Notes/Work/A note.md')
	})

	it('takes the read-only marker an update reports', () => {
		store.updateNote({ id: 1, readonly: true })

		expect(store.getNote(1).readonly).toBe(true)
	})

	it('keeps the path and the read-only marker when an update carries neither', () => {
		store.updateNote({ id: 1, title: 'Renamed' })

		expect(store.getNote(1).internalPath).toBe('/Notes/A note.md')
		expect(store.getNote(1).readonly).toBe(false)
		expect(store.getNote(1).title).toBe('Renamed')
	})
})

describe('notes store category filtering', () => {
	let store

	beforeEach(() => {
		setActivePinia(createPinia())
		store = useNotesStore()
		const notes = [
			{ id: 1, title: 'Loose', category: '' },
			{ id: 2, title: 'In Work', category: 'Work' },
			{ id: 3, title: 'In child', category: 'Work/Projects' },
			{ id: 4, title: 'In grandchild', category: 'Work/Projects/2026' },
			{ id: 5, title: 'Elsewhere', category: 'Personal' },
		]
		notes.forEach((note) => store.updateNote({ ...note, internalPath: '', readonly: false }))
	})

	/**
	 * @return {Array<number>} the ids the note list would show
	 */
	function visibleIds() {
		return store.getFilteredNotes().map((note) => note.id)
	}

	it('shows every note when nothing is selected', () => {
		store.setSelectedCategory(null)
		expect(visibleIds().sort()).toEqual([1, 2, 3, 4, 5])
	})

	it('shows only the notes filed directly in the selected category', () => {
		store.setSelectedCategory('Work')
		expect(visibleIds()).toEqual([2])
	})

	it('shows only the notes of a selected nested category', () => {
		store.setSelectedCategory('Work/Projects')
		expect(visibleIds()).toEqual([3])
	})

	it('shows only uncategorized notes for the uncategorized selection', () => {
		store.setSelectedCategory('')
		expect(visibleIds()).toEqual([1])
	})
})

describe('notes store search', () => {
	let store

	beforeEach(() => {
		setActivePinia(createPinia())
		store = useNotesStore()
		const notes = [
			{ id: 1, title: 'Loose report', category: '' },
			{ id: 2, title: 'Work report', category: 'Work' },
			{ id: 3, title: 'Nested report', category: 'Work/Projects' },
			{ id: 4, title: 'Unrelated', category: 'Personal' },
		]
		notes.forEach((note) => store.updateNote({ ...note, internalPath: '', readonly: false }))
	})

	/**
	 * @return {Array<number>} the ids the note list would show
	 */
	function visibleIds() {
		return store.getFilteredNotes().map((note) => note.id).sort()
	}

	it('searches every category, whichever one is selected', () => {
		store.setSelectedCategory('Work')
		useAppStore().updateSearchText('report')

		expect(visibleIds()).toEqual([1, 2, 3])
	})

	it('searches every category from the uncategorized selection too', () => {
		store.setSelectedCategory('')
		useAppStore().updateSearchText('report')

		expect(visibleIds()).toEqual([1, 2, 3])
	})

	it('returns to the selected category once the search is cleared', () => {
		store.setSelectedCategory('Work')
		useAppStore().updateSearchText('report')
		useAppStore().updateSearchText('')

		expect(visibleIds()).toEqual([2])
	})
})

describe('notes store content search', () => {
	let store
	let app

	beforeEach(() => {
		setActivePinia(createPinia())
		store = useNotesStore()
		app = useAppStore()
		const notes = [
			{ id: 1, title: 'Shopping', category: '' },
			{ id: 2, title: 'Minutes', category: 'Work' },
			{ id: 3, title: 'Report', category: 'Work' },
		]
		notes.forEach((note) => store.updateNote({ ...note, internalPath: '', readonly: false }))
	})

	/**
	 * @return {Array<number>} the ids the note list would show
	 */
	function visibleIds() {
		return store.getFilteredNotes().map((note) => note.id).sort()
	}

	it('shows what the server matched, including notes whose title does not', () => {
		app.updateSearchText('quarterly')
		app.setSearchResults({ term: 'quarterly', noteIds: [2] })

		// The word is in the body of note 2, which no title filter would find.
		expect(visibleIds()).toEqual([2])
	})

	it('falls back to titles until the server answers', () => {
		app.updateSearchText('report')

		expect(visibleIds()).toEqual([3])
	})

	it('ignores results belonging to an earlier search', () => {
		app.setSearchResults({ term: 'repo', noteIds: [1, 2, 3] })
		app.updateSearchText('report')

		expect(visibleIds()).toEqual([3])
	})

	it('still matches a title the server has not seen yet', () => {
		// A note being written is not on the disk the server searches.
		store.updateNote({ id: 4, title: 'Draft report', category: '', internalPath: '', readonly: false })
		app.updateSearchText('draft')
		app.setSearchResults({ term: 'draft', noteIds: [] })

		expect(visibleIds()).toEqual([4])
	})

	it('shows nothing when the server matched nothing', () => {
		app.updateSearchText('quarterly')
		app.setSearchResults({ term: 'quarterly', noteIds: [] })

		expect(visibleIds()).toEqual([])
	})
})
