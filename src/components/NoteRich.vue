<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="text-editor-wrapper" :class="{ loading: loading, 'icon-error': !loading && (!note || note.error), 'is-mobile': isMobile }">
		<div v-show="!loading" ref="editor" class="text-editor" />
	</div>
</template>

<script>

import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { markRaw } from 'vue'
import { queueCommand, refreshNote } from '../NotesService.js'
import store from '../store.js'
import { routeIsNewNote, tagsMayHaveChanged } from '../Util.js'

/* Anything shaped like a tag. Deliberately looser than the server's parser:
   this only has to notice that the hashes in the text changed, and a false
   positive costs one save. */
const HASH_WORD = /#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu

/* Long enough that typing a tag is one save rather than one per letter. */
const TAG_SAVE_DELAY = 1500

/* How long Text's own autosave takes to be accepted, for the editors that
   cannot be asked to save. Its server allows one every ten seconds. */
const TAG_AUTOSAVE_WAIT = 11000

export default {
	name: 'NoteRich',

	props: {
		noteId: {
			type: String,
			required: true,
		},
	},

	setup() {
		return {
			isMobile: useIsMobile(),
		}
	},

	data() {
		return {
			loading: false,
			editor: null,
			shouldAutotitle: true,
			hashWords: null,
			tagSaveTimer: null,
			tagRefreshTimer: null,
		}
	},

	computed: {
		note() {
			return store.notes.getNote(parseInt(this.noteId))
		},

		isNewNote() {
			return routeIsNewNote(this.$route)
		},
	},

	watch: {
		$route(to, from) {
			if (to.name !== from.name || to.params.noteId !== from.params.noteId) {
				this.onClose(from.params.noteId)
				this.fetchData()
			}
		},
	},

	mounted() {
		this.fetchData()
		subscribe('files:node:updated', this.fileUpdated)
		subscribe('files_versions:restore:requested', this.onFileRestoreRequested)
		subscribe('files_versions:restore:restored', this.onFileRestored)
		subscribe('files_versions:restore:failed', this.onFileRestoreFailed)
	},

	unmounted() {
		this.clearTagTimers()
		this?.editor?.destroy()
		unsubscribe('files:node:updated', this.fileUpdated)
		unsubscribe('files_versions:restore:requested', this.onFileRestoreRequested)
		unsubscribe('files_versions:restore:restored', this.onFileRestored)
		unsubscribe('files_versions:restore:failed', this.onFileRestoreFailed)
	},

	methods: {
		async fetchData() {
			this.etag = null

			if (this.isMobile) {
				emit('toggle-navigation', { open: false })
			}

			this.loading = true

			await this.loadTextEditor()
		},

		async loadTextEditor() {
			if (!this.$refs?.editor) {
				await this.$nextTick()
			}
			this?.editor?.destroy()
			this.loading = true
			this.shouldAutotitle = undefined
			this.clearTagTimers()
			this.hashWords = this.readHashWords(this.note?.content ?? '')
			this.editor = markRaw(await window.OCA.Text.createEditor({
				el: this.$refs.editor,
				fileId: parseInt(this.noteId),
				filePath: this.note.internalPath,
				readOnly: false,
				onLoaded: () => {
					this.loading = false
				},
				onUpdate: ({ markdown }) => {
					if (this.note) {
						const unsaved = !!(this.note?.content && this.note.content !== markdown)
						if (this.shouldAutotitle === undefined) {
							const title = this.getTitle(markdown)
							this.shouldAutotitle = this.isNewNote || (title !== '' && title === this.note.title)
						}
						this.onEdit({ content: markdown, unsaved })
						this.saveIfTagsChanged(markdown)
					}
				},
			}))
		},

		onEdit(noteData = {}) {
			store.notes.updateNote({
				...this.note,
				...noteData,
			})
		},

		onClose(noteId) {
			const note = store.notes.getNote(parseInt(noteId))
			if (!note || !Number.isFinite(note.id)) {
				return
			}
			store.notes.updateNote({
				...note,
				unsaved: false,
			})
		},

		fileUpdated({ fileid }) {
			if (this.note && this.note.id === fileid) {
				this.onEdit({ unsaved: false })
				if (this.shouldAutotitle) {
					queueCommand(fileid, 'autotitle')
				}
				this.refreshTags()
			}
		},

		/**
		 * The hashes in the text, as one comparable string.
		 *
		 * @param {string} markdown the note as it now stands
		 * @return {string} every hash word in it, lower-cased
		 */
		readHashWords(markdown) {
			return (markdown.match(HASH_WORD) ?? []).join(' ').toLowerCase()
		},

		clearTagTimers() {
			if (this.tagSaveTimer !== null) {
				clearTimeout(this.tagSaveTimer)
				this.tagSaveTimer = null
			}
			if (this.tagRefreshTimer !== null) {
				clearTimeout(this.tagRefreshTimer)
				this.tagRefreshTimer = null
			}
		},

		/**
		 * Write the note out when its tags change, rather than waiting.
		 *
		 * The tags are parsed from the file, and Text's own autosave is only
		 * accepted by the server every ten seconds, so a tag typed just after a
		 * save would sit invisible until then — long enough to read as nothing
		 * having happened. A save Text is asked for skips that throttle, and the
		 * write brings the parsed tags back through the refresh below.
		 *
		 * Only the hashes are compared, so ordinary typing writes no more often
		 * than it did before.
		 *
		 * @param {string} markdown the note as it now stands
		 */
		saveIfTagsChanged(markdown) {
			const hashWords = this.readHashWords(markdown)
			if (this.hashWords === null || hashWords === this.hashWords) {
				this.hashWords = hashWords
				return
			}
			this.hashWords = hashWords
			this.clearTagTimers()
			this.tagSaveTimer = setTimeout(() => {
				this.tagSaveTimer = null
				this.saveAndRefreshTags()
			}, TAG_SAVE_DELAY)
		},

		/**
		 * Write the note out, then read back what the server parsed from it.
		 *
		 * The refresh hangs off the save rather than off Text's save event: that
		 * event is emitted even when the server refused the write, so it is no
		 * promise that anything reached the disk. Waiting for the request to
		 * finish is.
		 */
		async saveAndRefreshTags() {
			if (typeof this.editor?.save !== 'function') {
				/* An editor that cannot be asked still writes the file through
				   its own autosave. Later is better than never. */
				this.tagRefreshTimer = setTimeout(() => {
					this.tagRefreshTimer = null
					this.refreshTags()
				}, TAG_AUTOSAVE_WAIT)
				return
			}
			try {
				await this.editor.save()
			} catch {
				// Text reports its own save failures; a second complaint here
				// would say nothing new.
			}
			this.refreshTags()
		},

		/**
		 * Ask the server what it parsed out of the note that was just written.
		 *
		 * Text saves the file itself rather than through the Notes API, so
		 * nothing comes back from the save to say which tags the note now
		 * carries. Without this the navigation would not show a tag until the
		 * page was reloaded. The plain editor needs none of this: it saves
		 * through the API, whose response carries the note's tags already.
		 */
		refreshTags() {
			const note = this.note
			if (!note) {
				return
			}
			if (!tagsMayHaveChanged(note)) {
				return
			}
			refreshNote(note.id, note.etag).catch(() => {})
		},

		getTitle(content) {
			const firstLine = content.split('\n')[0] ?? ''
			const title = firstLine
				// See NoteUtil::sanitisePath
				.replaceAll(/^\s*[*+-]\s+/gmu, '')
				.replaceAll(/^[.\s]+/gmu, '')
				.replaceAll(/\*|\||\/|\\|:|"|'|<|>|\?/gmu, '')
				// See NoteUtil::stripMarkdown
				.replaceAll(/^#+\s+(.*?)\s*#*$/gmu, '$1')
				.replaceAll(/^(=+|-+)$/gmu, '')
				.replaceAll(/(\*+|_+)(.*?)\\1/gmu, '$2')
				.replaceAll(/\s/gmu, ' ')
			return title.length > 0 ? title : t('notes', 'New note')
		},

		// the node of a restore carries a numeric fileid, a version a string fileId
		isCurrentNote(fileId) {
			return this.note && Number(fileId) === this.note.id
		},

		onFileRestoreRequested({ node }) {
			if (!this.isCurrentNote(node?.fileid)) {
				return
			}

			this.loading = true
		},

		onFileRestoreFailed(version) {
			if (!this.isCurrentNote(version?.fileId)) {
				return
			}

			this.loading = false
		},

		async onFileRestored({ node }) {
			if (!this.isCurrentNote(node?.fileid)) {
				return
			}

			try {
				const etag = await refreshNote(parseInt(this.noteId), this.etag)

				if (etag) {
					this.etag = etag
				}
			} finally {
				this.loading = false
			}
		},
	},
}
</script>

<style lang="scss" scoped>
.text-editor-wrapper {
	height: 100%;
}

.text-editor {
	height: 100%;
}

.note-container {
	min-height: 100%;
	width: 100%;
	background-color: var(--color-main-background);
}

/* Nextcloud core renders emphasis as lighter text rather than italics
   (`em { font-style: normal; color: var(--color-text-maxcontrast) }` in
   core/css/apps.scss). Text puts the italics back but not the color, so
   emphasis inside the editor comes out grey. The preview editor already
   corrects this the same way. */
.text-editor:deep(.ProseMirror em) {
	color: inherit;
}

/* The browser's own `mark` styling forces near-black text. Against the dark
   theme's --color-mark (#4d3800) that lands at 1.88:1, which is why a highlight
   there is unreadable. The ground itself is themed by core and left alone; only
   the text has to follow the body, which takes the dark theme to 9.36:1. */
.text-editor:deep(.ProseMirror mark) {
	color: inherit;
}

.is-mobile:deep(.text-menubar) {
	// Avoid overlapping the navigation toggle
	margin-inline-start: var(--default-clickable-area);
	z-index: 1;
}
</style>
