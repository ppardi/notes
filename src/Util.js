/**
 * SPDX-FileCopyrightText: 2021 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const noteAttributes = [
	'id',
	'etag',
	'title',
	'content',
	'modified',
	'favorite',
	'category',
	'tags',
]

export function copyNote(from, to, exclude) {
	if (exclude === undefined) {
		exclude = []
	}
	noteAttributes.forEach((attr) => {
		if (!exclude.includes(attr)) {
			to[attr] = from[attr]
		}
	})
	return to
}

/* The empty category is the notes folder itself, where notes that have not
   been filed anywhere live. It is named for what it is for rather than for
   what it lacks, and it only appears while something is sitting in it. */
export function categoryLabel(category) {
	return category === '' ? t('notes', 'Unfiled') : category.replace(/\//g, ' / ')
}

/**
 * Whether a note belongs to the selected category.
 *
 * A null selection matches every note. Otherwise a note belongs to the
 * category it is filed in and to no other: selecting a category shows what is
 * in it, not everything beneath it, so that each category in the tree can be
 * looked at on its own.
 *
 * @param {string} noteCategory the note's category
 * @param {string|null} selectedCategory the selected category, or null for all notes
 * @return {boolean} whether the note belongs to the selection
 */
export function isInCategory(noteCategory, selectedCategory) {
	return selectedCategory === null || noteCategory === selectedCategory
}

/**
 * The route query that selects a category.
 *
 * The all-notes selection drops the parameter entirely, which is what tells it
 * apart from the uncategorized selection: that one is a real category and keeps
 * an empty parameter.
 *
 * @param {string|null} category the selected category, or null for all notes
 * @return {object} query fields to merge into the route
 */
export function categoryToQuery(category) {
	return { category: category === null ? undefined : category }
}

/**
 * The category a route query selects.
 *
 * @param {object} [query] the route query
 * @return {string|null} the selected category, or null for all notes
 */
export function categoryFromQuery(query) {
	const value = query?.category
	if (value === undefined || value === null) {
		return null
	}
	return Array.isArray(value) ? (value[0] ?? '') : value
}

/**
 * The tags a route query selects.
 *
 * @param {object} [query] the route query
 * @return {string[]} the selected tags, empty when none are
 */
export function tagsFromQuery(query) {
	const value = query?.tags
	const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
	return String(raw).split(',').map((tag) => tag.trim()).filter((tag) => tag !== '')
}

/**
 * How a route query combines several tags.
 *
 * Anything that is not exactly "all" is "any", so a hand-edited or stale URL
 * cannot produce a mode the filter has no branch for.
 *
 * @param {object} [query] the route query
 * @return {string} 'all' or 'any'
 */
export function tagModeFromQuery(query) {
	const value = query?.mode
	return (Array.isArray(value) ? value[0] : value) === 'all' ? 'all' : 'any'
}

/**
 * Query fields that select a set of tags.
 *
 * The default mode is left out of the URL, so the common case stays readable.
 *
 * @param {string[]} tags the selected tags
 * @param {string} mode 'all' or 'any'
 * @return {object} query fields to merge into the route
 */
export function tagsToQuery(tags, mode) {
	const selected = (tags ?? []).filter((tag) => tag !== '')
	return {
		tags: selected.length ? selected.join(',') : undefined,
		mode: selected.length && mode === 'all' ? 'all' : undefined,
	}
}

/**
 * The route that selects a set of tags, keeping the rest of the current query.
 *
 * A tag and a category are alternative answers to "where am I looking", never
 * combined, so this drops the category on the way.
 *
 * @param {object} $route the current route
 * @param {string[]} tags the tags to select
 * @param {string} mode 'all' or 'any'
 * @return {object} the route to navigate to
 */
export function tagsRoute($route, tags, mode) {
	return {
		query: {
			...$route?.query,
			...categoryToQuery(null),
			...tagsToQuery(tags, mode),
		},
	}
}

/**
 * The route that selects a category, keeping the rest of the current query.
 *
 * @param {object} $route the current route
 * @param {string|null} category the category to select, or null for all notes
 * @return {object} a route location to push
 */
export function categoryRoute($route, category) {
	/* Tags are cleared on the way: a category and a set of tags are
	   alternatives, so the URL must never describe both. */
	return {
		query: {
			...$route?.query,
			...categoryToQuery(category),
			...tagsToQuery([], 'any'),
		},
	}
}

/**
 * A route query that keeps the selected category.
 *
 * The route owns the selection, so every navigation has to carry it or the
 * category is dropped on the way.
 *
 * @param {object} $route the current route
 * @param {object} [query] the query the target route wants
 * @return {object} that query, plus the current category
 */
export function keepCategory($route, query = {}) {
	return { ...query, ...categoryToQuery(categoryFromQuery($route?.query)) }
}

const CATEGORY_SETTING_PREFIX = 'category:'

/**
 * The setting value that stores a selected category.
 *
 * A plain category name cannot be stored on its own: the uncategorized
 * category is the empty string, which an unset setting is indistinguishable
 * from. The prefix keeps the two apart.
 *
 * @param {string|null} category the selected category, or null for all notes
 * @return {string} the value to store
 */
export function categoryToSetting(category) {
	return category === null ? 'all' : CATEGORY_SETTING_PREFIX + category
}

/**
 * The category a stored setting value selects.
 *
 * Anything unset or unrecognised reads as all notes.
 *
 * @param {string} [value] the stored value
 * @return {string|null} the category, or null for all notes
 */
export function categoryFromSetting(value) {
	if (typeof value !== 'string' || !value.startsWith(CATEGORY_SETTING_PREFIX)) {
		return null
	}
	return value.slice(CATEGORY_SETTING_PREFIX.length)
}

export function routeIsNewNote($route) {
	return Object.hasOwn($route.query, 'new')
}

export const CATEGORY_DRAG_TYPE = 'application/x-nextcloud-notes-category'

/**
 * Whether a drag is carrying a category.
 *
 * @param {object} event the drag event
 * @return {boolean} whether a category is being dragged
 */
export function isCategoryDrag(event) {
	const types = event?.dataTransfer?.types
	return types ? Array.from(types).includes(CATEGORY_DRAG_TYPE) : false
}

/**
 * The category a drag is carrying.
 *
 * The uncategorized category is the empty string, so the presence of the type
 * is what decides, not the value.
 *
 * @param {object} event the drag event
 * @return {string|null} the dragged category, or null if there is none
 */
export function getDraggedCategory(event) {
	if (!isCategoryDrag(event)) {
		return null
	}
	try {
		return event.dataTransfer.getData(CATEGORY_DRAG_TYPE)
	} catch {
		return null
	}
}

export function isNoteDrag(event) {
	const dt = event?.dataTransfer
	if (!dt) {
		return false
	}

	const types = Array.from(dt.types ?? [])
	if (types.includes('application/x-nextcloud-notes-note-id')) {
		return true
	}
	if (types.includes('text/uri-list')) {
		return false
	}
	try {
		return /^\s*\d+\s*$/.test(dt.getData('text/plain'))
	} catch {
		return false
	}
}

export function getDraggedNoteId(event, getNoteById) {
	const dt = event?.dataTransfer
	if (!dt) {
		return null
	}

	const types = Array.from(dt.types ?? [])
	const hasCustom = types.includes('application/x-nextcloud-notes-note-id')
	const hasUri = types.includes('text/uri-list')
	if (!hasCustom && hasUri) {
		return null
	}

	let raw = ''
	if (hasCustom) {
		try {
			raw = dt.getData('application/x-nextcloud-notes-note-id')
		} catch {
			// Some browsers only allow specific mime types.
		}
	}
	if (!raw) {
		try {
			raw = dt.getData('text/plain')
		} catch {
			raw = ''
		}
	}

	const match = /^\s*(\d+)\s*$/.exec(raw)
	const noteId = match ? Number.parseInt(match[1], 10) : Number.NaN
	if (!Number.isFinite(noteId)) {
		return null
	}
	const note = getNoteById ? getNoteById(noteId) : null
	if (!note || note.readonly) {
		return null
	}

	return noteId
}

export function getDefaultSampleNoteTitle() {
	return t('notes', 'Sample note')
}

/* eslint-disable @stylistic/indent-binary-ops */
export function getDefaultSampleNote() {
	return '# ' + getDefaultSampleNoteTitle() + `

* 📅 ` + t('notes', '15 January 2021, via Nextcloud Notes') + `
* 👥 ` + t('notes', 'Me, you, and all our friends!') + `

## ` + t('notes', 'Tasks') + ` ✅

* [ ] ` + t('notes', 'Write nice todo lists') + `
* [ ] ` + t('notes', 'Buy Fries') + `
* [ ] …

## ` + t('notes', 'Birthdays') + `

* ` + t('notes', 'Jen, in three days!') + `
* ` + t('notes', 'Moss, 21.03.1973') + `
* ` + t('notes', 'Roy, 1979') + `

## ` + t('notes', 'Review Steps') + ` 🔁

1. ` + t('notes', 'Turn PC off') + `
2. ` + t('notes', 'Turn PC on') + `
3. ` + t('notes', 'Then call IT') + `

## ` + t('notes', 'Quotes') + ` 💬

> ` + t('notes', 'Nextcloud, a safe home for all your data') + `
`
}
/* eslint-enable @stylistic/indent-binary-ops */

export function escapeHtml(str) {
	const element = document.createElement('div')
	element.textContent = str
	return element.innerHTML
}
