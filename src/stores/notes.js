/**
 * SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import logger from '../Logger.js'
import { copyNote } from '../Util.js'
import { useAppStore } from './app.js'

/**
 * Reported by the server but not note attributes, so copyNote() leaves them
 * behind: the path changes when the note moves category, and the read-only
 * marker when the file's permissions change.
 */
const SERVER_FIELDS = ['internalPath', 'readonly']

export const useNotesStore = defineStore('notes', {
	state: () => ({
		categories: [],
		localCategories: [],
		notes: [],
		notesIds: {},
		selectedCategory: null,
		/* Tags and a category are alternative answers to "where am I looking",
		   never combined: selecting one clears the other. */
		selectedTags: [],
		tagMode: 'any',
		selectedNote: null,
		filterString: '',
	}),

	getters: {
		numNotes: (state) => () => {
			return state.notes.length
		},

		noteExists: (state) => (id) => {
			return state.notesIds[id] !== undefined
		},

		getNote: (state) => (id) => {
			if (state.notesIds[id] === undefined) {
				return null
			}
			return state.notesIds[id]
		},

		getCategories: (state) => (maxLevel, details) => {
			function nthIndexOf(str, pattern, n) {
				let i = -1
				while (n-- && i++ < str.length) {
					i = str.indexOf(pattern, i)
					if (i < 0) {
						break
					}
				}
				return i
			}

			function normalizeCategory(category) {
				let cat = category
				if (maxLevel > 0) {
					const index = nthIndexOf(cat, '/', maxLevel)
					if (index > 0) {
						cat = cat.substring(0, index)
					}
				}
				return cat
			}

			// get categories from notes
			const categories = {}
			for (const note of state.notes) {
				const cat = normalizeCategory(note.category)
				if (categories[cat] === undefined) {
					categories[cat] = 1
				} else {
					categories[cat] += 1
				}
			}
			const extraCategories = new Set([...state.categories, ...state.localCategories])
			for (const category of extraCategories) {
				if (!category) {
					continue
				}
				const cat = normalizeCategory(category)
				if (!cat) {
					continue
				}
				if (categories[cat] === undefined) {
					categories[cat] = 0
				}
			}
			// get structured result from categories
			const result = []
			for (const category in categories) {
				if (details) {
					result.push({
						name: category,
						count: categories[category],
					})
				} else if (category) {
					result.push(category)
				}
			}
			if (details) {
				result.sort((a, b) => a.name.localeCompare(b.name))
			} else {
				result.sort()
			}
			return result
		},

		getFilteredNotes: (state) => () => {
			const appStore = useAppStore()
			const searchText = appStore.searchText.toLowerCase()
			/* A search spans every category. The search box sits above the note
			   list rather than inside a category, so scoping it to the selected
			   one hides the matches people are looking for. */
			const searching = searchText !== ''
			/* The server searches what is written inside a note, which the
			   browser does not hold. Until its answer arrives, and if it never
			   does, matching titles keeps the list responsive to typing. */
			const results = appStore.searchResults
			/* The server answers with the term it actually searched, which it
			   trims, so stray whitespace must not look like a stale answer. */
			const matched = searching && results?.term === appStore.searchText.trim()
				? new Set(results.noteIds)
				: null
			const notes = state.notes.filter((note) => {
				if (!searching && state.selectedCategory !== null && state.selectedCategory !== note.category) {
					return false
				}

				if (!searching && state.selectedTags.length > 0) {
					const tags = note.tags ?? []
					const matches = state.tagMode === 'all'
						? state.selectedTags.every((tag) => tags.includes(tag))
						: state.selectedTags.some((tag) => tags.includes(tag))
					if (!matches) {
						return false
					}
				}

				if (searching) {
					const titleMatches = note.title.toLowerCase().indexOf(searchText) !== -1
					/* Titles still count alongside the server's answer: a note
					   being written has not reached the disk the server reads,
					   and it should not vanish from a search for its own title. */
					return matched === null ? titleMatches : titleMatches || matched.has(note.id)
				}

				return true
			})

			function cmpRecent(a, b) {
				if (a.favorite && !b.favorite) {
					return -1
				}
				if (!a.favorite && b.favorite) {
					return 1
				}
				return b.modified - a.modified
			}

			function cmpCategory(a, b) {
				const cmpCat = a.category.localeCompare(b.category)
				if (cmpCat !== 0) {
					return cmpCat
				}
				if (a.favorite && !b.favorite) {
					return -1
				}
				if (!a.favorite && b.favorite) {
					return 1
				}
				return a.title.localeCompare(b.title)
			}

			notes.sort(state.selectedCategory === null ? cmpRecent : cmpCategory)

			return notes
		},

		/* The tags in use, with how many notes carry each. Derived from the
		   loaded notes rather than fetched, exactly as the category list is:
		   the server already sends each note's tags, so there is nothing more
		   to ask it for. */
		getTags: (state) => () => {
			const counts = new Map()
			for (const note of state.notes) {
				for (const tag of note.tags ?? []) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1)
				}
			}
			return [...counts.entries()]
				.map(([name, count]) => ({ name, count }))
				.sort((a, b) => a.name.localeCompare(b.name))
		},

		/* How many notes carry a set of tags. The same reading the note list
		   gives the same set: "all" wants every tag on one note, anything else
		   wants any of them. */
		countNotesWithTags: (state) => (tags, mode) => {
			if (!tags || tags.length === 0) {
				return 0
			}
			return state.notes.filter((note) => {
				const carried = note.tags ?? []
				return mode === 'all'
					? tags.every((tag) => carried.includes(tag))
					: tags.some((tag) => carried.includes(tag))
			}).length
		},

		getSelectedTags: (state) => () => {
			return state.selectedTags
		},

		getTagMode: (state) => () => {
			return state.tagMode
		},

		getSelectedCategory: (state) => () => {
			return state.selectedCategory
		},

		getSelectedNote: (state) => () => {
			return state.selectedNote
		},
	},

	actions: {
		updateNote(updated) {
			const note = this.notesIds[updated.id]
			if (note) {
				copyNote(updated, note, ['id', 'etag', 'content'])
				for (const field of SERVER_FIELDS) {
					if (updated[field] !== undefined) {
						note[field] = updated[field]
					}
				}
				// don't update meta-data over full data
				if (updated.content !== undefined && updated.etag !== undefined) {
					note.content = updated.content
					note.etag = updated.etag
					note.unsaved = updated.unsaved
					note.error = updated.error
					note.errorType = updated.errorType
				}
			} else {
				this.notes.push(updated)
				this.notesIds[updated.id] = updated
			}
		},

		setNoteAttribute({ noteId, attribute, value }) {
			const note = this.notesIds[noteId]
			if (note) {
				note[attribute] = value
			}
		},

		removeNote(id) {
			this.notes = this.notes.filter((note) => note.id !== id)
			delete this.notesIds[id]
		},

		removeAllNotes() {
			this.notes = []
			this.notesIds = {}
		},

		setCategories(categories) {
			this.categories = categories
			categories.forEach((category) => {
				if (category && !this.localCategories.includes(category)) {
					this.localCategories.push(category)
				}
			})
		},

		addLocalCategory(category) {
			if (!category || this.localCategories.includes(category) || this.categories.includes(category)) {
				return
			}
			this.localCategories.push(category)
		},

		renameLocalCategory({ oldCategory, newCategory }) {
			if (!oldCategory || !newCategory || oldCategory === newCategory) {
				return
			}
			this.localCategories = this.localCategories.map((category) => {
				if (category === oldCategory) {
					return newCategory
				}
				if (category.startsWith(oldCategory + '/')) {
					return newCategory + category.slice(oldCategory.length)
				}
				return category
			})
			this.categories = this.categories.map((category) => {
				if (category === oldCategory) {
					return newCategory
				}
				if (category.startsWith(oldCategory + '/')) {
					return newCategory + category.slice(oldCategory.length)
				}
				return category
			})
		},

		removeLocalCategory(category) {
			if (!category) {
				return
			}
			this.localCategories = this.localCategories.filter((cat) => cat !== category && !cat.startsWith(category + '/'))
			this.categories = this.categories.filter((cat) => cat !== category && !cat.startsWith(category + '/'))
		},

		setSelectedCategory(category) {
			this.selectedCategory = category
			this.selectedTags = []
		},

		setSelectedTags(tags, mode = 'any') {
			this.selectedTags = [...tags]
			this.tagMode = mode === 'all' ? 'all' : 'any'
			this.selectedCategory = null
		},

		setSelectedNote(note) {
			this.selectedNote = note
		},

		updateNotes({ noteIds, notes }) {
			// add/update new notes
			if (!notes || !noteIds) {
				// TODO remove this block after fixing #886
				logger.error('This should not happen, please see issue #886', { notes, noteIds })
				// eslint-disable-next-line no-console
				console.trace()
				return
			}
			for (const note of notes) {
				// TODO check for parallel (local) changes!
				this.updateNote(note)
			}
			// remove deleted notes
			this.notes.forEach((note) => {
				if (!noteIds.includes(note.id)) {
					this.removeNote(note.id)
				}
			})
		},
	},
})
