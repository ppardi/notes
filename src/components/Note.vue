<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NoteRich v-if="isRichMode" :noteId="noteId" />
	<NotePlain v-else-if="isPlainMode" :noteId="noteId" />
	<div v-else />
</template>

<script>
import NotePlain from './NotePlain.vue'
import NoteRich from './NoteRich.vue'
import { isRawNote } from '../rawNote.js'
import store from '../store.js'

export default {
	name: 'Note',

	components: {
		NoteRich,
		NotePlain,
	},

	props: {
		noteId: {
			type: String,
			required: true,
		},
	},

	computed: {
		/* One note can be dropped out of rich text without changing the setting
		   for the rest. It is not remembered: the markdown editor lasts as long
		   as that note is open. */
		isRawNote() {
			return isRawNote(Number(this.noteId))
		},

		isRichMode() {
			return OC.appswebroots?.text
				&& store.app?.settings?.noteMode === 'rich'
				&& !this.isRawNote
		},

		isPlainMode() {
			return store.app?.settings?.noteMode === 'edit'
				|| store.app?.settings?.noteMode === 'preview'
				|| this.isRawNote
		},
	},

	watch: {
		noteId() {
			/* Reading a different note is leaving the one that was turned raw. */
			store.notes.clearRawNote()
		},
	},
}
</script>
