<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="text-editor-wrapper" :class="{ loading: loading, 'icon-error': !loading && (!note || note.error), 'is-mobile': isMobile }">
		<div v-show="!loading" ref="editor" class="text-editor" />
		<TagCompletion :editorElement="editorElement" @select="onTagCompleted" />
	</div>
</template>

<script>

import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { markRaw } from 'vue'
import TagCompletion from './TagCompletion.vue'
import logger from '../Logger.js'
import { queueCommand, refreshNote } from '../NotesService.js'
import { borrowProseMirror, hasTopLevelHeading, headingFoldPlugin } from '../proseMirrorHeadingFold.js'
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

	components: {
		TagCompletion,
	},

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
			editorElement: null,
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
		subscribe('notes:editor:close', this.closeForWrite)
		subscribe('notes:editor:reopen', this.reopenAfterWrite)
		subscribe('files_versions:restore:requested', this.onFileRestoreRequested)
		subscribe('files_versions:restore:restored', this.onFileRestored)
		subscribe('files_versions:restore:failed', this.onFileRestoreFailed)
	},

	unmounted() {
		this.clearTagTimers()
		this?.editor?.destroy()
		unsubscribe('files:node:updated', this.fileUpdated)
		unsubscribe('notes:editor:close', this.closeForWrite)
		unsubscribe('notes:editor:reopen', this.reopenAfterWrite)
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
			this.editorElement = null
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
					this.editorElement = this.$refs.editor
					this.installHeadingFold()
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

		/**
		 * Let the reader fold the note's sections under their headings.
		 *
		 * Text keeps its editor to itself: the handle it hands back holds the
		 * ProseMirror instance in a private field, and the only way to reach it
		 * is the element tiptap marks with itself. That is not a promise Text has
		 * made, so this asks rather than insists — without it the note is still
		 * perfectly readable and editable, only unfoldable.
		 *
		 * The fold is drawn with decorations, which are the view's own layer and
		 * never reach the file, and nothing about it is written down: it lasts
		 * while the note is open and starts again from nothing.
		 */
		async installHeadingFold() {
			await this.$nextTick()
			const editor = this.$refs?.editor?.querySelector('.ProseMirror')?.editor
			if (typeof editor?.registerPlugin !== 'function') {
				logger.debug('Text exposes no editor to fold headings with')
				return
			}

			const install = () => {
				const prosemirror = borrowProseMirror(editor)
				if (!prosemirror) {
					return false
				}
				try {
					editor.registerPlugin(headingFoldPlugin(prosemirror, {
						collapseLabel: t('notes', 'Collapse section'),
						expandLabel: t('notes', 'Expand section'),
						formatHidden: (count) => this.n('notes', '%n block hidden', '%n blocks hidden', count),
					}))
				} catch (error) {
					logger.warn('Could not fold headings in this note', { error })
				}
				return true
			}

			if (install() || typeof editor.on !== 'function') {
				return
			}

			/* A note with no headings lends nothing to borrow from, and wants no
			   folding either. Rather than leave the controls missing for as long
			   as the note stays open, wait for its first heading — but ask the
			   cheap question on every keystroke and the expensive one only once
			   there is something to fold. Borrowing walks every plugin the
			   editor holds, which is not a thing to do while someone types. */
			const retry = () => {
				if (!hasTopLevelHeading(editor.state?.doc)) {
					return
				}
				if (install()) {
					editor.off('update', retry)
				}
			}
			editor.on('update', retry)
		},

		/**
		 * Finish the tag that was being typed.
		 *
		 * Only the letters still missing are inserted, since the caret is
		 * already sitting at the end of what was typed.
		 *
		 * @param {object} completion the chosen tag and what had been typed
		 * @param {string} completion.tag the tag to complete to
		 * @param {string} completion.partial the letters already there
		 */
		onTagCompleted({ tag, partial }) {
			const missing = tag.slice(partial.length)
			if (missing !== '') {
				this.editor?.insertAtCursor?.(missing)
			}
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
		 * Let go of this note so that something else can write it.
		 *
		 * The Text app locks a note for as long as it has it open, and it holds
		 * the text in a session of its own that no other app can set — so a
		 * write from outside is refused, and a write that did get through would
		 * be saved over by this editor anyway. Closing it first answers both:
		 * the lock goes, and there is no session left holding the old text.
		 *
		 * What is on screen is saved before it goes.
		 *
		 * @param {object} event the event
		 * @param {number} event.noteId the note being written
		 */
		async closeForWrite({ noteId }) {
			if (!this.note || this.note.id !== noteId || !this.editor) {
				return
			}
			this.clearTagTimers()
			try {
				await this.editor.save?.()
			} catch {
				// Text reports its own save failures.
			}
			this.editor.destroy()
			this.editor = null
			this.loading = true
			emit('notes:editor:closed', { noteId })
		},

		/**
		 * Open the note again, against whatever it now holds.
		 *
		 * @param {object} event the event
		 * @param {number} event.noteId the note that was written
		 */
		reopenAfterWrite({ noteId }) {
			if (!this.note || this.note.id !== noteId || this.editor) {
				return
			}
			this.loadTextEditor()
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

/* Folding is a reading convenience drawn over the editor rather than written
   into the note, so its control sits in the margin and leaves the heading's
   own text exactly where it was. */
/* The heading itself is the control: clicking it folds its section. This
 * button is what is left for anyone not using a mouse — reachable by Tab and
 * announced by a screen reader, but given no width, so that no heading is
 * pushed in from the prose to make room for it.
 *
 * Important, and named by its tag, reluctantly: ProseMirror marks every widget
 * `contenteditable="false"`, and Text zeroes the margin of anything matching
 * `[contenteditable]` with an `!important` of its own, at the same specificity
 * as this rule and from a stylesheet that loads later. Naming the element is
 * the one point of specificity that settles it. */
/* The control sits in the margin beside the heading, anchored to the heading's
 * leading edge rather than sized from its text — so every heading offers it in
 * the same place whatever its level, however long it runs, and whether or not
 * it wraps. A control that moves is a control you have to look for.
 *
 * Important, and named by its tag, reluctantly: ProseMirror marks every widget
 * `contenteditable="false"`, and Text zeroes the margin of anything matching
 * `[contenteditable]` with an `!important` of its own, at the same specificity
 * as this rule and from a stylesheet that loads later. Naming the element is
 * the one point of specificity that settles it. */
.text-editor:deep(button.note-fold__toggle) {
	position: absolute;
	inset-inline-end: 100%;
	width: 20px;
	margin: 0 !important;
	margin-inline-end: 4px !important;
	min-width: 0;
	min-height: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-text-maxcontrast);
	font-size: 15px;
	line-height: inherit;
	text-align: center;
	cursor: pointer;
	opacity: 0.55;
}

.text-editor:deep(button.note-fold__toggle:hover),
.text-editor:deep(button.note-fold__toggle:focus-visible),
.text-editor:deep(button.note-fold__toggle[aria-expanded='false']) {
	opacity: 1;
}

/* That margin was Text's before it was ours: it draws a link to the section
 * there. Only one of the two can have it, so folding keeps it while the note
 * is being read and hands it back while a heading is being written — which is
 * the only time a link to that one section is worth reaching for. Text reveals
 * its own control on hover, exactly as it always did; this only stops
 * competing for the space. */
.text-editor:deep(h1 .heading-anchor),
.text-editor:deep(h2 .heading-anchor),
.text-editor:deep(h3 .heading-anchor),
.text-editor:deep(h4 .heading-anchor),
.text-editor:deep(h5 .heading-anchor),
.text-editor:deep(h6 .heading-anchor) {
	display: none;
}

.text-editor:deep(.note-fold__editing .heading-anchor) {
	display: revert;
}

.text-editor:deep(.note-fold__editing .note-fold__toggle) {
	display: none;
}

.text-editor:deep(.note-fold__hidden) {
	display: none;
}

/* Says how much is out of sight, so a folded section reads as folded rather
   than as a heading someone forgot to write under. */
.text-editor:deep(span.note-fold__badge) {
	/* Important, and named by its tag, for the same reason as the control. */
	margin-inline-start: 0.75em !important;
	color: var(--color-text-maxcontrast);
	font-size: 0.6em;
	font-weight: normal;
	vertical-align: middle;
}

.is-mobile:deep(.text-menubar) {
	// Avoid overlapping the navigation toggle
	margin-inline-start: var(--default-clickable-area);
	z-index: 1;
}
</style>
