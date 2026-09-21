/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
	state: () => ({
		settings: {},
		isSaving: false,
		isManualSave: false,
		documentTitle: null,
		searchText: '',
		/**
		 * Which notes the server matched, and the search it was answering. The
		 * term is kept so that an answer to an earlier search can be ignored.
		 */
		searchResults: null,
		/**
		 * Zen mode hides the app's category sidebar and the note list, leaving just the note.
		 */
		zenMode: false,
	}),

	actions: {
		setSettings(settings) {
			this.settings = settings
		},

		setNoteMode(mode) {
			this.settings.noteMode = mode
		},

		setSaving(isSaving) {
			this.isSaving = isSaving
		},

		setManualSave(isManualSave) {
			this.isManualSave = isManualSave
		},

		setDocumentTitle(title) {
			this.documentTitle = title
		},

		updateSearchText(searchText) {
			this.searchText = searchText
		},

		setSearchResults({ term, noteIds }) {
			this.searchResults = { term, noteIds }
		},

		setZenMode(zenMode) {
			this.zenMode = zenMode
		},

		toggleZenMode() {
			this.zenMode = !this.zenMode
		},
	},
})
