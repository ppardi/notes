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

export function categoryLabel(category) {
	return category === '' ? t('notes', 'Uncategorized') : category.replace(/\//g, ' / ')
}

/**
 * Whether a note's category falls within the selected one.
 *
 * A null selection matches every note. Otherwise a note matches the selected
 * category itself and any category nested below it.
 *
 * @param {string} noteCategory the note's category
 * @param {string|null} selectedCategory the selected category, or null for all notes
 * @return {boolean} whether the note belongs to the selection
 */
export function isInCategory(noteCategory, selectedCategory) {
	if (selectedCategory === null) {
		return true
	}
	return noteCategory === selectedCategory
		|| noteCategory.startsWith(selectedCategory + '/')
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
 * The route that selects a category, keeping the rest of the current query.
 *
 * @param {object} $route the current route
 * @param {string|null} category the category to select, or null for all notes
 * @return {object} a route location to push
 */
export function categoryRoute($route, category) {
	return { query: { ...$route?.query, ...categoryToQuery(category) } }
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

export function routeIsNewNote($route) {
	return Object.hasOwn($route.query, 'new')
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
