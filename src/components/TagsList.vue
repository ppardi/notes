<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<!-- Nothing at all until something is tagged: the navigation must not grow
	     a heading for a feature that has not been used yet. -->
	<template v-if="tags.length > 0">
		<!-- Nothing inline: everything about the current filter lives in the one
		     menu, rather than a button beside a menu holding the rest. -->
		<NcAppNavigationCaption v-show="!loading"
			:name="t('notes', 'Tags')"
			:inline="0"
		>
			<!-- Only while something is filtered: a query is saved from what is
			     on screen rather than built in the abstract. -->
			<template v-if="selectedTags.length > 0" #actions>
				<NcActionButton :closeAfterClick="true" @click="onSaveAsSmartFolder">
					<template #icon>
						<FolderCogOutlineIcon :size="20" />
					</template>
					{{ t('notes', 'Save as smart folder') }}
				</NcActionButton>
				<NcActionButton v-if="folderHasChanged"
					:closeAfterClick="true"
					@click="onUpdateSmartFolder"
				>
					<template #icon>
						<FolderCogOutlineIcon :size="20" />
					</template>
					{{ t('notes', 'Update “{folder}”', { folder: openFolder }) }}
				</NcActionButton>
				<NcActionButton v-if="selectedTags.length > 1"
					:closeAfterClick="true"
					@click="onToggleMode"
				>
					<template #icon>
						<FilterOutlineIcon :size="20" />
					</template>
					{{ tagMode === 'all' ? t('notes', 'Match any tag') : t('notes', 'Match all tags') }}
				</NcActionButton>
			</template>
		</NcAppNavigationCaption>

		<NcAppNavigationItem v-for="tag in tags"
			v-show="!loading"
			:key="tag.name"
			:ref="(el) => setTagRef(tag.name, el)"
			:name="tag.name"
			:active="selectedTags.includes(tag.name)"
			:editPlaceholder="tag.name"
			forceMenu
			class="tag-entry"
			@click.prevent.stop="onSelect(tag.name, $event)"
			@update:name="onRename(tag.name, $event)"
		>
			<template #icon>
				<PoundIcon :size="20" />
			</template>
			<template #counter>
				<NcCounterBubble :count="tag.count" />
			</template>
			<template #actions>
				<NcActionButton :closeAfterClick="true" @click="startRename(tag.name)">
					<template #icon>
						<PencilOutlineIcon :size="20" />
					</template>
					{{ t('notes', 'Rename tag') }}
				</NcActionButton>
			</template>
		</NcAppNavigationItem>
	</template>
</template>

<script>
import { showWarning } from '@nextcloud/dialogs'
import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import FilterOutlineIcon from 'vue-material-design-icons/FilterOutline.vue'
import FolderCogOutlineIcon from 'vue-material-design-icons/FolderCogOutline.vue'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'
import PoundIcon from 'vue-material-design-icons/Pound.vue'
import { fetchNotes, renameTag } from '../NotesService.js'
import store from '../store.js'
import { smartFolderFromQuery, tagsRoute } from '../Util.js'

/* Long enough for the lock to have gone, short enough not to be noticed. */
const RENAME_RETRY_DELAY = 400
const RENAME_ATTEMPTS = 4

/* If no editor answers, the rename goes ahead rather than hanging on it. */
const CLOSE_TIMEOUT = 5000

export default {
	name: 'TagsList',

	components: {
		NcActionButton,
		NcAppNavigationCaption,
		NcAppNavigationItem,
		NcCounterBubble,
		FilterOutlineIcon,
		FolderCogOutlineIcon,
		PencilOutlineIcon,
		PoundIcon,
	},

	props: {
		loading: Boolean,
	},

	data() {
		return {
			tagItems: {},
		}
	},

	computed: {
		/* Derived from the loaded notes, the way the category list is: the
		   server already sends each note's tags, so there is nothing to fetch. */
		tags() {
			return store.notes.getTags()
		},

		selectedTags() {
			return store.notes.getSelectedTags()
		},

		tagMode() {
			return store.notes.getTagMode()
		},

		/* The smart folder these tags were opened from, if any. */
		openFolder() {
			return smartFolderFromQuery(this.$route.query)
		},

		/* Whether what is on screen has moved away from what that folder holds,
		   which is when offering to update it means something. */
		folderHasChanged() {
			if (this.openFolder === null) {
				return false
			}
			const folder = (store.app.settings?.smartFolders ?? [])
				.find((saved) => saved.name === this.openFolder)
			if (!folder) {
				return false
			}
			return folder.tags.length !== this.selectedTags.length
				|| !folder.tags.every((tag) => this.selectedTags.includes(tag))
				|| (this.selectedTags.length > 1 && folder.mode !== this.tagMode)
		},
	},

	methods: {
		setTagRef(tag, el) {
			if (el) {
				this.tagItems[tag] = el
			} else {
				delete this.tagItems[tag]
			}
		},

		startRename(tag) {
			this.tagItems[tag]?.handleEdit?.()
		},

		/* Naming a tag that already exists merges the two — the server rewrites
		   the notes either way, and the duplicate references collapse when they
		   are parsed again. */
		async onRename(from, to) {
			if (!to || to === from) {
				return
			}
			/* The note on screen is the one most likely to carry the tag, and
			   the one the server cannot write: the rich editor locks a note it
			   has open. It is closed for the length of the rename. */
			const held = this.heldNote(from)
			const result = held === null
				? await renameTag(from, to)
				: await this.renameWithEditorClosed(held.id, from, to)
			await fetchNotes()
			this.reportSkipped(result?.skipped ?? [])
			/* Following the selection matters: without it the list would empty
			   itself as the notes left the tag being renamed, which reads as
			   data loss rather than a rename. */
			if (this.selectedTags.includes(from)) {
				const following = this.selectedTags.map((tag) => (tag === from ? to : tag))
				this.$router.push(tagsRoute(this.$route, [...new Set(following)], store.notes.getTagMode()))
			}
		},

		/**
		 * The note the rich editor is holding, when it carries the tag.
		 *
		 * Only the rich editor matters here: the markdown editor saves through
		 * the API and takes no lock, so a rename reaches its note like any
		 * other.
		 *
		 * @param {string} tag the tag being renamed
		 * @return {object|null} the note, or null when none applies
		 */
		heldNote(tag) {
			if (!OC.appswebroots?.text || store.app?.settings?.noteMode !== 'rich') {
				return null
			}
			const noteId = store.notes.getSelectedNote()
			const note = noteId === null ? null : store.notes.getNote(noteId)
			if (!note) {
				return null
			}
			return (note.tags ?? []).includes(tag) ? note : null
		},

		/**
		 * Rename with the editor out of the way, then put it back.
		 *
		 * The lock the editor holds is released a moment after it closes, and
		 * not at a moment this can be told about, so a refused write is tried
		 * again rather than waited out. Everything else about the rename is the
		 * ordinary path, including what it reports.
		 *
		 * @param {number} noteId the note the editor is holding
		 * @param {string} from the tag to rewrite
		 * @param {string} to the tag to rewrite it as
		 * @return {Promise<object>} what the last attempt answered
		 */
		async renameWithEditorClosed(noteId, from, to) {
			await this.closeEditor(noteId)
			try {
				let result
				for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
					result = await renameTag(from, to)
					const stillLocked = (note) => note.id === noteId && note.reason === 'locked'
					const refused = (result?.skipped ?? []).some(stillLocked)
					if (!refused) {
						break
					}
					await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY))
				}
				return result
			} finally {
				emit('notes:editor:reopen', { noteId })
			}
		},

		/**
		 * Ask the editor to let go of a note, and wait until it has.
		 *
		 * Resolves anyway if nothing answers, so a rename is never left waiting
		 * on an editor that is not there.
		 *
		 * @param {number} noteId the note to close
		 * @return {Promise<void>} once the editor has closed, or given up on
		 */
		closeEditor(noteId) {
			return new Promise((resolve) => {
				let timer = null
				const onClosed = (event) => {
					if (event?.noteId !== noteId) {
						return
					}
					if (timer !== null) {
						clearTimeout(timer)
						timer = null
					}
					unsubscribe('notes:editor:closed', onClosed)
					resolve()
				}
				subscribe('notes:editor:closed', onClosed)
				timer = setTimeout(() => {
					timer = null
					unsubscribe('notes:editor:closed', onClosed)
					resolve()
				}, CLOSE_TIMEOUT)
				emit('notes:editor:close', { noteId })
			})
		},

		/**
		 * Say which notes the rename did not reach, and why.
		 *
		 * A note open in an editor is locked by the Files Lock app, and the note
		 * whose tag is being renamed is the one most likely to be open — so this
		 * is the common case, not the rare one. Reported rather than swallowed:
		 * a rename that changed nothing looked exactly like one that worked, and
		 * the tag was left half renamed with no way to tell.
		 *
		 * The titles come from the notes already loaded here, so the server has
		 * nothing extra to send.
		 *
		 * @param {Array<object>} skipped the notes the server did not rewrite
		 */
		reportSkipped(skipped) {
			const titles = (reason) => skipped
				.filter((note) => note.reason === reason)
				.map((note) => store.notes.getNote(note.id)?.title ?? String(note.id))
				.join(', ')

			const locked = titles('locked')
			if (locked !== '') {
				showWarning(t('notes', 'These notes are open in an editor, so the tag was not renamed in them: {notes}', { notes: locked }))
			}
			const readonly = titles('readonly')
			if (readonly !== '') {
				showWarning(t('notes', 'These notes are read-only, so the tag was not renamed in them: {notes}', { notes: readonly }))
			}
			const failed = titles('error')
			if (failed !== '') {
				showWarning(t('notes', 'The tag could not be renamed in these notes: {notes}', { notes: failed }))
			}
		},

		/**
		 * Choose a tag, or add one to those already chosen.
		 *
		 * The route owns the selection, so that it survives a reload and moves
		 * with the browser's history — and it drops the category, because a tag
		 * and a category are alternatives.
		 *
		 * @param {string} tag the tag that was clicked
		 * @param {object} [event] the click, whose modifier says which it was
		 */
		onSelect(tag, event) {
			if (!(event?.metaKey || event?.ctrlKey)) {
				// chosen by hand, so no longer what any saved query asked for
				this.$router.push(tagsRoute(this.$route, [tag], 'any'))
				return
			}

			const selected = this.selectedTags
			const next = selected.includes(tag)
				? selected.filter((name) => name !== tag)
				: [...selected, tag]
			/* Adding a second tag narrows the list: combining tags reads as
			   "and also this". Once that has been said, an explicit choice of
			   mode is left alone. */
			const mode = next.length > 1 && selected.length < 2 ? 'all' : this.tagMode
			/* The folder stays named while its filter is being changed, so that
			   the menu can offer to save the change back to it. */
			this.$router.push(tagsRoute(
				this.$route,
				next,
				next.length > 1 ? mode : 'any',
				next.length > 0 ? this.openFolder : null,
			))
		},

		onToggleMode() {
			this.$router.push(tagsRoute(
				this.$route,
				this.selectedTags,
				this.tagMode === 'all' ? 'any' : 'all',
				this.openFolder,
			))
		},

		onUpdateSmartFolder() {
			emit('notes:smart-folder:update', { name: this.openFolder })
		},

		/* The list of saved queries owns the naming, the way the category list
		   owns naming a new category. */
		onSaveAsSmartFolder() {
			emit('notes:smart-folder:new', {
				tags: [...this.selectedTags],
				mode: this.selectedTags.length > 1 ? this.tagMode : 'any',
			})
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
