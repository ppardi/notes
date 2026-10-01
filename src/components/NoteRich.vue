<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="text-editor-wrapper" :class="{ loading: loading, 'icon-error': !loading && (!note || note.error), 'is-mobile': isMobile }">
		<div v-show="!loading" ref="editor" class="text-editor" />
		<TagCompletion :editorElement="editorElement" @select="onTagCompleted" />
		<!-- The button is wrapped rather than made sticky itself: NcButton
		     positions itself, and a sticky rule on it is overruled.

		     Refusing the default on mousedown is what keeps the caret: the
		     press would otherwise take the focus out of the editor, and the
		     ink is written where the caret is. -->
		<div v-if="!loading" class="ink-open">
			<NcButton variant="secondary" @mousedown.prevent @click="openInk()">
				{{ t('notes', 'Ink') }}
			</NcButton>
		</div>
		<InkCanvas
			v-if="inkId"
			:noteId="Number(noteId)"
			:inkId="inkId"
			@saved="onInkSaved"
			@close="inkId = null"
		/>
	</div>
</template>

<script>

import { showError } from '@nextcloud/dialogs'
import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { markRaw } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import InkCanvas from './InkCanvas.vue'
import TagCompletion from './TagCompletion.vue'
import { closeEditor, reopenEditor } from '../editorHandoff.js'
import { loadInk } from '../inkFile.js'
import { inkContent, inkIdFromUrl, makeInkId } from '../inkLink.js'
import { refreshInkPicture } from '../inkRefresh.js'
import { inkIdFromNode } from '../inkTap.js'
import logger from '../Logger.js'
import { queueCommand, refreshNote } from '../NotesService.js'
import { borrowProseMirror, hasTopLevelHeading, headingFoldPlugin } from '../proseMirrorHeadingFold.js'
import store from '../store.js'
import { findTextEditor } from '../textEditor.js'
import { routeIsNewNote, tagsMayHaveChanged } from '../Util.js'
import { restoreVersion } from '../versionRestore.js'

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
		InkCanvas,
		NcButton,
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
			inkId: null,
			newInk: false,
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
		this.stopListeningForInk()
		this?.editor?.destroy()
		unsubscribe('files:node:updated', this.fileUpdated)
		unsubscribe('notes:editor:close', this.closeForWrite)
		unsubscribe('notes:editor:reopen', this.reopenAfterWrite)
		unsubscribe('files_versions:restore:requested', this.onFileRestoreRequested)
		unsubscribe('files_versions:restore:restored', this.onFileRestored)
		unsubscribe('files_versions:restore:failed', this.onFileRestoreFailed)
	},

	methods: {
		/**
		 * Open the canvas, on a new ink block or one already in the note.
		 *
		 * @param {string | null} id the ink to reopen, or null for a new one
		 */
		async openInk(id = null) {
			this.newInk = id === null
			if (id !== null) {
				/* The picture can be deleted while its link stays behind. Opening
				   a canvas over nothing would write a file the note no longer
				   points at, so say so instead. */
				let existing
				try {
					existing = await loadInk(Number(this.noteId), id)
				} catch (error) {
					/* Callers do not await this - a tap and a link click both
					   fire and forget - so anything thrown here would surface
					   as an unhandled rejection and the reader would be told
					   nothing at all while the canvas never opened. */
					logger.error('Opening ink failed', { noteId: this.noteId, id, error })
					showError(t('notes', 'The ink could not be opened. Please try again.'))
					return
				}
				if (existing === null) {
					/* Hedged on purpose: a 404 is the server's word that the file was
					   not found, not proof that it was deleted, and the link may be
					   the only thing that still points at it. */
					showError(t('notes', 'The picture for this ink could not be found. It may have been deleted. Nothing has been changed.'))
					return
				}
			}
			this.inkId = id ?? makeInkId()
		},

		/**
		 * Open the canvas when a tap lands on ink.
		 *
		 * Capture phase, so Text's own handler does not open the viewer first.
		 * Anything that is not ink is left entirely alone.
		 *
		 * @param {MouseEvent} event the click
		 */
		onEditorClick(event) {
			const id = inkIdFromNode(event.target, this.noteId)
			if (id === null) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			this.openInk(id)
		},

		/**
		 * Stop listening for taps on ink. Safe to call when nothing listens.
		 */
		stopListeningForInk() {
			this.$refs?.editor?.removeEventListener('click', this.onEditorClick, true)
		},

		/**
		 * @param {string} href the link, absolute or relative
		 * @return {boolean} whether it resolves to this server
		 */
		isSameOrigin(href) {
			try {
				return new URL(href, window.location.href).origin === window.location.origin
			} catch {
				return false
			}
		},

		/**
		 * Open a link that is not ours, the way Text does when nobody has
		 * claimed links: resolved against this page, in a new tab.
		 *
		 * Claiming links replaces that behaviour for every link in every note,
		 * so it is restated here rather than assumed. The one difference is
		 * noopener, so a page a note links to gets no handle on this one.
		 *
		 * @param {string} href the link, absolute or relative
		 */
		openOrdinaryLink(href) {
			let target = href
			try {
				target = new URL(href, window.location.href).href
			} catch {
				/* Not a URL the browser can resolve: pass it on as it came, as
				   Text's own handler would have thrown on it. */
			}
			window.open(target, '_blank', 'noopener')
		},

		/**
		 * @param {object} saved what the canvas saved
		 * @param {string} saved.id the ink's id
		 */
		onInkSaved({ id }) {
			/* Only a new block is written into the note. Re-editing overwrites
			   the file under the same name, so the markdown already points at
			   it and rewriting would only churn the note. */
			if (this.newInk) {
				this.placeCaretForInk()
				this.editor?.insertAtCursor?.(inkContent(Number(this.noteId), id))
				return
			}
			/* Which is also why the picture on screen is still the old one:
			   nothing about the document changed, so Text has no reason to
			   render the image again and the browser answers for a URL it has
			   already fetched out of its cache. */
			refreshInkPicture(this.$refs.editor, Number(this.noteId), id)
		},

		/**
		 * Make sure the ink goes somewhere the reader would choose.
		 *
		 * A note that was only opened, never clicked into, has the caret where
		 * ProseMirror starts it: inside the first block, which is the heading
		 * the note's title and file name are read from. Ink written there
		 * would become the note's first line, and the next autotitle would
		 * rename the file after an image. So a caret in the first block sends
		 * the ink to the end of the note instead, and anywhere else the
		 * reader's own caret is kept, with a selected range collapsed to its
		 * end so that inserting cannot delete what they had selected.
		 *
		 * Reaches the editor the way installHeadingFold does, because the
		 * handle Text returns can focus but cannot say where the caret is.
		 * When it cannot be reached the ink goes in wherever focus puts it,
		 * which is the hazard above, so findTextEditor says so in the log.
		 */
		placeCaretForInk() {
			const tiptap = findTextEditor(this.$refs?.editor)
			const selection = tiptap?.state?.selection
			if (!selection || typeof tiptap.commands?.focus !== 'function') {
				if (tiptap) {
					logger.warn('Text\'s editor has no caret to read; placing the ink where focus lands')
				}
				this.editor?.focus?.()
				return
			}
			if (selection.$to.index(0) === 0) {
				tiptap.commands.focus('end')
			} else if (!selection.empty) {
				tiptap.commands.setTextSelection(selection.to)
			}
		},

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
			this.stopListeningForInk()
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
					/* onLoaded runs on every editor creation, and this fork
					   recreates the editor for the close-and-reopen dance in
					   src/editorHandoff.js. The element is the same each time.
					   A second registration of this same bound function would be
					   ignored by the browser anyway; removing first is
					   belt-and-braces on top of that, and what really matters is
					   removing it wherever the editor is torn down. */
					this.stopListeningForInk()
					this.$refs.editor?.addEventListener('click', this.onEditorClick, true)
				},
				openLinkHandler: (href) => {
					/* Text hands us the resolved absolute URL, while the document
					   holds a relative path - so the id is read off the tail.
					   Anything that is not ours is handed straight back. */
					/* Ours only when it points at this server: the path alone
					   cannot tell this app's ink from another instance's. */
					const id = this.isSameOrigin(href) ? inkIdFromUrl(href) : null
					if (id === null) {
						this.openOrdinaryLink(href)
						return
					}
					this.openInk(id)
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
		 * Text keeps its editor to itself, so this asks for it through
		 * findTextEditor rather than insisting — without it the note is still
		 * perfectly readable and editable, only unfoldable.
		 *
		 * The fold is drawn with decorations, which are the view's own layer and
		 * never reach the file, and nothing about it is written down: it lasts
		 * while the note is open and starts again from nothing.
		 */
		async installHeadingFold() {
			await this.$nextTick()
			const editor = findTextEditor(this.$refs?.editor)
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
			this.stopListeningForInk()
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

		/**
		 * Take the restore over while this note is open in the editor.
		 *
		 * Text holds a lock on a note for as long as its editor has it, and the
		 * restore is a DAV MOVE from outside that lock: it came back 423 and the
		 * note kept the version it had. The sidebar lets a listener take the
		 * restore on instead, so close the editor - which drops the lock - and
		 * make the move ourselves.
		 *
		 * @param {object} event the sidebar's event, whose preventDefault is a
		 *                       field it reads back rather than a method
		 */
		onFileRestoreRequested(event) {
			if (!this.isCurrentNote(event?.node?.fileid)) {
				return
			}

			this.loading = true
			/* Read synchronously the moment this returns, so it cannot wait for
			   the editor to close - hence doing the whole restore here. */
			event.preventDefault = true
			this.restoreWithEditorClosed(event)
		},

		/**
		 * Close the editor, restore the version, and open it again.
		 *
		 * @param {object} event the sidebar's event
		 * @param {object} event.node the node as it will be once restored
		 * @param {object} event.version the version to restore
		 */
		async restoreWithEditorClosed({ node, version }) {
			const noteId = this.note.id
			try {
				await closeEditor(noteId)
				await restoreVersion(version)
				/* What the sidebar would have emitted, so the versions list and
				   everything else watching hear about it as they always did. */
				emit('files:node:updated', node)
				emit('files_versions:restore:restored', { node, version })
			} catch (error) {
				logger.error('Could not restore this version', { error })
				showError(t('notes', 'Could not restore this version.'))
				emit('files_versions:restore:failed', version)
			} finally {
				reopenEditor(noteId)
			}
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
	/* As tall as the note, not as tall as the window: the Ink button sticks to
	   the bottom of the pane, and a sticky element only sticks for as long as
	   the box it is in is on screen. At one screen tall it came unstuck
	   immediately and rode up the page with the text.

	   A minimum rather than a height, so the button is still at the foot of
	   the pane on a note too short to scroll - sized to the full height it
	   was pushed below the bottom of the window, out of reach on a phone. */
	min-height: 100%;
	display: flex;
	flex-direction: column;
}

.text-editor {
	flex: 1;
	/* A flex child will not shrink below its content unless told it may. */
	min-height: 0;
}

/* Always in the same corner. It used to sit at the foot of a box one screen
   tall, so on a long note it rode up the page as the reader scrolled and came
   to rest beside a paragraph in the middle of the text. Sticky keeps it where
   it was put, and the solid variant keeps it readable over the words it now
   floats above. */
.ink-open {
	position: sticky;
	bottom: calc(var(--default-grid-baseline) * 2);
	flex: none;
	align-self: flex-end;
	margin-block-end: calc(var(--default-grid-baseline) * 2);
	margin-inline-end: calc(var(--default-grid-baseline) * 2);
}

/* Ink follows the theme where it is rendered, the same way the canvas it was
   drawn on does. Ink in any note's attachment folder counts, not only this
   note's: unlike a tap, which writes and so must be sure whose ink it opens,
   colouring only has to be right about what the picture is, and a file named
   this way in a Notes attachment folder is this app's ink wherever it came
   from. An ordinary picture, and one on another host, are left alone. Only
   the picture is recoloured, so Text's caption and controls keep theirs. */
.text-editor:deep(figure[data-component="image-view"][data-src^=".attachments."][data-src*="/ink-"][data-src$=".png"] img) {
	/* Lightness flipped, hue kept. The variable is `invert(100%)` on a dark
	   theme and `no` on a light one, so this is `invert(100%) hue-rotate(180deg)`
	   there and an invalid - therefore ignored - declaration here. Extending
	   the variable rather than writing the theme's own selector is what makes
	   this track whatever the server decides is dark, including themes that do
	   not exist yet.

	   Without the rotation, invert flips hue along with lightness and a red
	   annotation reads cyan. With it, a dark red becomes a light red. */
	filter: var(--background-invert-if-dark) hue-rotate(180deg);
	/* And is shown at the size it was drawn, which is what makes it sharp.
	   Markdown cannot say how big to show an image, so a picture is laid out
	   at one image pixel per CSS pixel and every pixel of it is doubled on a
	   retina screen. Ink is saved at INK_DENSITY pixels for each CSS pixel of
	   drawing and shown at the reciprocal of that: the drawing is the size it
	   was written, with as many pixels as the screen can use. Keep the two in
	   step - 1 / INK_DENSITY. */
	zoom: 0.5;
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
	/* Sized to be hit rather than to fit its glyph. A chevron wants about
	   fifteen pixels and the margin it sits in is narrow, so left alone the
	   control comes out smaller than anything should be that a person has to
	   aim at — smaller at a level-three heading than a level-two one, since
	   the line it sits on is shorter. These hold it at the smallest size worth
	   aiming at, and the box is transparent, so the extra reach costs nothing
	   on screen.

	   It grows towards the text rather than away from it. The margin further
	   out belongs to Text's own insert and drag handles, which appear under
	   the pointer — exactly when this control is about to be clicked — and
	   take the click if they are underneath it. */
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	margin: 0 !important;
	min-width: 0;
	min-height: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-text-maxcontrast);
	font-size: 22px;
	line-height: 1;
	border-radius: var(--border-radius, 4px);
	cursor: pointer;
	opacity: 0.6;
}

/* On a phone the editor leaves a 22px margin - the same at 320px wide as at
   390 - and both this control and Text's own anchor are wider than that, so
   hung outside the heading they reach past the side of the screen. Clipped,
   and far enough out to make the note pannable sideways, which reads as text
   that will not hold still while you scroll.

   Both are pulled in until they are flush with the edge. The glyph is centred
   in a box wider than itself, so it still clears the heading; only the
   transparent part of the target laps over the first few pixels of the text,
   where a tap folds the section rather than placing the cursor.

   Text's anchor is moved rather than taken out of the layout: it is what the
   outline panel scrolls to, and a box that is not drawn is still a box to
   scroll to. Removing it is what broke the outline once already. */
.is-mobile .text-editor {
	--note-fold-margin: 22px;
}

.is-mobile .text-editor:deep(button.note-fold__toggle) {
	inset-inline-end: calc(100% - (28px - var(--note-fold-margin)));
}

.is-mobile .text-editor:deep(.heading-anchor) {
	inset-inline-start: calc(-1 * var(--note-fold-margin));
}

/* Under the pointer the box shows itself. Half of what makes a small control
   hard to hit is not knowing where it ends. */
.text-editor:deep(button.note-fold__toggle:hover),
.text-editor:deep(button.note-fold__toggle:focus-visible) {
	background: var(--color-background-hover);
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
 * competing for the space.
 *
 * Hidden, not removed. That anchor carries the id every entry in Text's
 * outline points at, and an element with `display: none` draws no box, so
 * there is nothing left for the outline to scroll to and the whole panel stops
 * navigating. Kept hidden it still has a box to land on, and still takes no
 * clicks away from the control in front of it. */
.text-editor:deep(h1 .heading-anchor),
.text-editor:deep(h2 .heading-anchor),
.text-editor:deep(h3 .heading-anchor),
.text-editor:deep(h4 .heading-anchor),
.text-editor:deep(h5 .heading-anchor),
.text-editor:deep(h6 .heading-anchor) {
	visibility: hidden;
}

.text-editor:deep(.note-fold__editing .heading-anchor) {
	visibility: visible;
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
	/* And give back what that margin takes. The bar is as wide as the pane
	   already, so starting it a toggle's width in makes the pane wider than
	   itself - and a pane a little wider than itself is something a thumb can
	   drag sideways while its owner is only trying to scroll down. A pointing
	   device never finds it, which is why this showed on a phone and a tablet
	   held upright but never on a desk or a tablet turned over. */
	max-width: calc(100% - var(--default-clickable-area));
	z-index: 1;
}

/* Below Nextcloud's mobile breakpoint Text turns this row around, putting the
   toolbar under the note. That is the right call on a platform whose layout
   shrinks when the keyboard opens: the bar lands just above the keys, next to
   the line being typed. iOS Safari never shrinks - only the visual viewport
   does - so the keyboard simply covers the bar, and the placement costs its
   own reason for existing. Kept the way round a tablet held sideways already
   has it, which is also the way the desktop has it.

   Matching their two classes and beating them by one: the scoped attribute
   only ties this rule, so without the repeat the two carry equal weight and
   the winner is whichever stylesheet loaded last. */
.is-mobile:deep(.text-editor__main.is-mobile) {
	flex-direction: column;
}
</style>
