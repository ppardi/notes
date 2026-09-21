<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcTextField v-model="searchText"
		:label="t('notes', 'Search for notes')"
		:showTrailingButton="searchText !== ''"
		trailingButtonIcon="close"
		:trailingButtonLabel="t('notes', 'Clear search')"
		@trailingButtonClick="searchText = ''"
	/>
</template>

<script>

import NcTextField from '@nextcloud/vue/components/NcTextField'
import { searchNotes } from '../NotesService.js'
import store from '../store.js'

export default {
	name: 'NotesSearch',

	components: {
		NcTextField,
	},

	computed: {
		searchText: {
			get() {
				return store.app.searchText
			},

			set(value) {
				store.app.updateSearchText(value)
				this.requestSearch(value)
			},
		},
	},

	beforeUnmount() {
		clearTimeout(this.searchTimer)
	},

	methods: {
		/* One request per pause in typing rather than per keystroke: the server
		   reads every note to answer this. */
		requestSearch(term) {
			clearTimeout(this.searchTimer)
			if (term === '') {
				store.app.setSearchResults({ term: '', noteIds: [] })
				return
			}
			this.searchTimer = setTimeout(() => searchNotes(term), 250)
		},
	},
}
</script>
