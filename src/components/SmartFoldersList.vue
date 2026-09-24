<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<!-- Nothing at all until a query has been saved: the navigation must not
	     grow a heading for something nobody has used. -->
	<template v-if="folders.length > 0 || draft !== null">
		<NcAppNavigationCaption v-show="!loading"
			:name="t('notes', 'Smart folders')"
			:inline="1"
		/>

		<NcAppNavigationItem v-if="draft !== null"
			v-show="!loading"
			:ref="(el) => setDraftRef(el)"
			name=""
			:editPlaceholder="draftPlaceholder"
			class="smart-folder-entry"
			@click.prevent.stop
			@update:name="onCreate"
		>
			<template #icon>
				<FolderCogOutlineIcon :size="20" />
			</template>
			<template #counter>
				<NcCounterBubble :count="countIn(draft)" />
			</template>
		</NcAppNavigationItem>

		<NcAppNavigationItem v-for="(folder, index) in folders"
			v-show="!loading"
			:key="`${index}-${folder.name}`"
			:ref="(el) => setFolderRef(index, el)"
			:name="folder.name"
			:active="isSelected(folder)"
			:editPlaceholder="folder.name"
			:title="describe(folder)"
			forceMenu
			class="smart-folder-entry"
			@click.prevent.stop="onSelect(folder)"
			@update:name="onRename(index, $event)"
		>
			<template #icon>
				<FolderCogOutlineIcon :size="20" />
			</template>
			<template #counter>
				<NcCounterBubble :count="countIn(folder)" />
			</template>
			<template #actions>
				<NcActionButton :closeAfterClick="true" @click="startRename(index)">
					<template #icon>
						<PencilOutlineIcon :size="20" />
					</template>
					{{ t('notes', 'Rename smart folder') }}
				</NcActionButton>
				<NcActionButton :closeAfterClick="true" @click="onDelete(index)">
					<template #icon>
						<DeleteOutlineIcon :size="20" />
					</template>
					{{ t('notes', 'Delete smart folder') }}
				</NcActionButton>
			</template>
		</NcAppNavigationItem>
	</template>
</template>

<script>
import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import DeleteOutlineIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FolderCogOutlineIcon from 'vue-material-design-icons/FolderCogOutline.vue'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'
import { setSettings } from '../NotesService.js'
import store from '../store.js'
import { tagsRoute } from '../Util.js'

export default {
	name: 'SmartFoldersList',

	components: {
		DeleteOutlineIcon,
		FolderCogOutlineIcon,
		NcActionButton,
		NcAppNavigationCaption,
		NcAppNavigationItem,
		NcCounterBubble,
		PencilOutlineIcon,
	},

	props: {
		loading: Boolean,
	},

	data() {
		return {
			/* The query being named, or null while none is. */
			draft: null,
			folderItems: {},
			draftItem: null,
		}
	},

	computed: {
		folders() {
			return store.app.settings?.smartFolders ?? []
		},

		selectedTags() {
			return store.notes.getSelectedTags()
		},

		tagMode() {
			return store.notes.getTagMode()
		},

		draftPlaceholder() {
			return this.draft === null ? '' : this.draft.tags.map((tag) => `#${tag}`).join(' ')
		},
	},

	mounted() {
		subscribe('notes:smart-folder:new', this.onNew)
	},

	unmounted() {
		unsubscribe('notes:smart-folder:new', this.onNew)
	},

	methods: {
		setDraftRef(el) {
			this.draftItem = el ?? null
		},

		setFolderRef(index, el) {
			if (el) {
				this.folderItems[index] = el
			} else {
				delete this.folderItems[index]
			}
		},

		startRename(index) {
			this.folderItems[index]?.handleEdit?.()
		},

		onNew({ tags, mode }) {
			if (!Array.isArray(tags) || tags.length === 0) {
				return
			}
			this.draft = { name: '', tags: [...tags], mode: mode === 'all' ? 'all' : 'any' }
			/* Straight into the name field, the way a new category is. */
			this.$nextTick(() => this.draftItem?.handleEdit?.())
		},

		/**
		 * How many notes a query holds, counted the way the list filters.
		 *
		 * @param {object} folder the saved query
		 * @return {number} the notes it holds
		 */
		countIn(folder) {
			return store.notes.countNotesWithTags(folder.tags, folder.mode)
		},

		/**
		 * What the folder is looking for, for the row's tooltip.
		 *
		 * @param {object} folder the saved query
		 * @return {string} the tags it names, and how it combines them
		 */
		describe(folder) {
			const tags = folder.tags.map((tag) => `#${tag}`).join(' ')
			return folder.mode === 'all' && folder.tags.length > 1
				? t('notes', 'Notes with all of: {tags}', { tags })
				: tags
		},

		isSelected(folder) {
			return this.selectedTags.length === folder.tags.length
				&& folder.tags.every((tag) => this.selectedTags.includes(tag))
				&& (folder.tags.length < 2 || this.tagMode === folder.mode)
		},

		onSelect(folder) {
			this.$router.push(tagsRoute(this.$route, folder.tags, folder.mode))
		},

		async onCreate(name) {
			const draft = this.draft
			this.draft = null
			if (draft === null || !name) {
				return
			}
			await this.save([...this.folders, { ...draft, name }])
		},

		async onRename(index, name) {
			const folder = this.folders[index]
			if (!folder || !name || name === folder.name) {
				return
			}
			const folders = this.folders.map((existing, at) => (
				at === index ? { ...existing, name } : existing
			))
			await this.save(folders)
		},

		/* No confirmation: a smart folder holds no notes, and saving it again
		   is the same two clicks it took to make. */
		async onDelete(index) {
			await this.save(this.folders.filter((existing, at) => at !== index))
		},

		/**
		 * Store the folders, and hold what the server made of them.
		 *
		 * The server normalises what it is given — names trimmed, tags read the
		 * way a note's are — so the answer is what the navigation shows rather
		 * than what was sent.
		 *
		 * @param {Array<object>} folders the folders to store
		 */
		async save(folders) {
			await setSettings({ smartFolders: folders })
			emit('notes:smart-folder:saved', {})
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
