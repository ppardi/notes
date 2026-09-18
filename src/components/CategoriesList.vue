<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcAppNavigationItem
		v-show="!loading"
		:name="t('notes', 'All notes')"
		:active="selectedCategory === null"
		:draggable="false"
		class="category-no-actions"
		:class="{
			'drop-over': dragOverAllNotes,
		}"
		@click.prevent.stop="onSelectCategory(null)"
		@dragstart="onCategoryDragStart"
		@dragover="onAllNotesDragOver($event)"
		@dragleave="onAllNotesDragLeave($event)"
		@drop="onAllNotesDrop($event)"
	>
		<template #icon>
			<HistoryIcon :size="20" />
		</template>
		<template #counter>
			<NcCounterBubble :count="numNotes" />
		</template>
	</NcAppNavigationItem>

	<NcAppNavigationCaption v-show="!loading"
		:name="t('notes', 'Categories')"
		:inline="1"
		:class="{ 'drop-over-caption': dragOverNewCategory }"
		@dragover="onNewCategoryDragOver($event)"
		@dragleave="onNewCategoryDragLeave($event)"
		@drop="onNewCategoryDrop($event)"
	>
		<template #actions>
			<NcActionButton v-if="!hideNewCategoryAction" @click="startNewCategory()">
				<template #icon>
					<FolderPlusIcon :size="20" />
				</template>
				{{ t('notes', 'New category') }}
			</NcActionButton>
		</template>
	</NcAppNavigationCaption>

	<NcAppNavigationItem
		v-if="newCategoryDraft"
		v-show="!loading"
		ref="newCategoryItem"
		name=""
		:draggable="false"
		:editPlaceholder="t('notes', 'New category')"
		class="category-draft"
		@click.prevent.stop
		@dragstart="onCategoryDragStart"
		@update:name="onCreateCategory"
	>
		<template #icon>
			<FolderIcon :size="20" />
		</template>
		<template #counter>
			<NcCounterBubble :count="0" />
		</template>
	</NcAppNavigationItem>

	<CategoryTreeItem v-for="node in categoryTree"
		:key="node.name"
		:node="node"
		:loading="loading"
		:selectedCategory="selectedCategory"
		:dragOverCategory="dragOverCategory"
		:collapsedCategories="collapsedCategories"
	/>
</template>

<script>
import { showConfirmation } from '@nextcloud/dialogs'
import { subscribe, unsubscribe } from '@nextcloud/event-bus'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import FolderIcon from 'vue-material-design-icons/Folder.vue'
import FolderPlusIcon from 'vue-material-design-icons/FolderPlusOutline.vue'
import HistoryIcon from 'vue-material-design-icons/History.vue'
import CategoryTreeItem from './CategoryTreeItem.vue'
import { buildCategoryTree, categoryAncestors, categoryDropTarget, categoryNames, pruneCollapsed, withCategoriesExpanded, withCategoryCollapsed } from '../categoryTree.js'
import { deleteCategory as deleteCategoryRequest, renameCategory as renameCategoryRequest, setCategory, setSettings } from '../NotesService.js'
import store from '../store.js'
import { CATEGORY_DRAG_TYPE, categoryLabel, categoryRoute, getDraggedCategory, getDraggedNoteId, isCategoryDrag, isNoteDrag, keepCategory } from '../Util.js'

export default {
	name: 'CategoriesList',

	components: {
		CategoryTreeItem,
		NcActionButton,
		NcAppNavigationItem,
		NcAppNavigationCaption,
		NcCounterBubble,
		FolderIcon,
		FolderPlusIcon,
		HistoryIcon,
	},

	provide() {
		return {
			tree: {
				select: (name) => this.onSelectCategory(name),
				startRename: (name) => this.onStartRenameCategory(name),
				rename: (name, newName) => this.onRenameCategory(name, newName),
				remove: (name) => this.onDeleteCategory(name),
				dragStart: (name, event) => this.onCategoryDragStart(name, event),
				dragOver: (name, event) => this.onCategoryDragOver(name, event),
				dragLeave: (name, event) => this.onCategoryDragLeave(name, event),
				drop: (name, event) => this.onCategoryDrop(name, event),
				setItemRef: (name, el) => this.setCategoryItemRef(name, el),
				setOpen: (name, open) => this.setCategoryOpen(name, open),
			},
		}
	},

	props: {
		loading: Boolean,
		hideNewCategoryAction: Boolean,
	},

	data() {
		return {
			dragOverCategory: null,
			dragOverNewCategory: false,
			dragOverAllNotes: false,
			newCategoryDraft: false,
			newCategoryMonitor: null,
			newCategoryDropNoteId: null,
			categoryItems: {},
			collapsedCategories: [],
			collapsedLoaded: false,
		}
	},

	computed: {
		numNotes() {
			return store.notes.numNotes()
		},

		categories() {
			return store.notes.getCategories(0, true)
		},

		categoryTree() {
			return buildCategoryTree(this.categories)
		},

		storedCollapsed() {
			return store.app.settings?.collapsedCategories
		},

		selectedCategory() {
			return store.notes.getSelectedCategory()
		},
	},

	watch: {
		/* The settings arrive after the first render, so the stored list is
		   adopted when it turns up rather than read once on creation. */
		storedCollapsed: {
			immediate: true,
			handler(stored) {
				if (!this.collapsedLoaded && Array.isArray(stored)) {
					this.collapsedCategories = [...stored]
					this.collapsedLoaded = true
				}
			},
		},

		selectedCategory: {
			immediate: true,
			handler(category) {
				this.revealCategory(category)
			},
		},
	},

	mounted() {
		subscribe('notes:category:new', this.startNewCategory)
	},

	unmounted() {
		unsubscribe('notes:category:new', this.startNewCategory)
		this.stopNewCategoryMonitor()
	},

	methods: {
		setCategoryOpen(category, open) {
			this.applyCollapsed(withCategoryCollapsed(this.collapsedCategories, category, !open))
		},

		/* Stored so the tree looks the same next time. Entries for categories
		   that have since gone are dropped rather than kept forever. */
		applyCollapsed(collapsed) {
			const pruned = pruneCollapsed(collapsed, categoryNames(this.categoryTree))
			if (pruned.join('\n') === this.collapsedCategories.join('\n')) {
				return
			}
			this.collapsedCategories = pruned
			if (this.collapsedLoaded) {
				setSettings({ collapsedCategories: pruned })
			}
		},

		/* A selection is useless if it is hidden inside a collapsed ancestor. */
		revealCategory(category) {
			const ancestors = categoryAncestors(category)
			if (ancestors.length === 0) {
				return
			}
			this.applyCollapsed(withCategoriesExpanded(this.collapsedCategories, ancestors))
		},

		setCategoryItemRef(category, el) {
			if (el) {
				this.categoryItems[category] = el
			} else {
				delete this.categoryItems[category]
			}
		},

		onStartRenameCategory(category) {
			this.categoryItems[category]?.handleEdit?.()
		},

		categoryTitle(category) {
			return categoryLabel(category)
		},

		startNewCategory(payload = {}) {
			if (this.newCategoryDraft) {
				return
			}
			this.newCategoryDropNoteId = payload?.noteId ?? null
			this.newCategoryDraft = true
			this.$nextTick(() => {
				this.$refs.newCategoryItem?.handleEdit?.()
				this.monitorNewCategoryEditing()
			})
		},

		onNewCategoryDragOver(event) {
			if (this.hideNewCategoryAction || !isNoteDrag(event)) {
				return
			}
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move'
			}
			this.dragOverNewCategory = true
		},

		onNewCategoryDragLeave(event) {
			// dragleave also fires when moving onto a child element, so ignore
			// events that are still inside the caption row
			if (event.currentTarget?.contains(event.relatedTarget)) {
				return
			}
			this.dragOverNewCategory = false
		},

		onNewCategoryDrop(event) {
			if (this.hideNewCategoryAction) {
				return
			}
			this.dragOverNewCategory = false
			const noteId = getDraggedNoteId(event, (noteId) => store.notes.getNote(noteId))
			if (noteId === null) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			this.startNewCategory({ noteId })
		},

		stopNewCategoryMonitor() {
			if (this.newCategoryMonitor) {
				cancelAnimationFrame(this.newCategoryMonitor)
				this.newCategoryMonitor = null
			}
		},

		monitorNewCategoryEditing() {
			this.stopNewCategoryMonitor()
			const check = () => {
				if (!this.newCategoryDraft) {
					this.stopNewCategoryMonitor()
					this.newCategoryDropNoteId = null
					return
				}
				const item = this.$refs.newCategoryItem
				if (item && item.editingActive === false) {
					this.newCategoryDraft = false
					this.stopNewCategoryMonitor()
					this.newCategoryDropNoteId = null
					return
				}
				this.newCategoryMonitor = requestAnimationFrame(check)
			}
			this.newCategoryMonitor = requestAnimationFrame(check)
		},

		onCreateCategory(newCategory) {
			const trimmed = newCategory?.trim() ?? ''
			this.newCategoryDraft = false
			this.stopNewCategoryMonitor()
			const droppedNoteId = this.newCategoryDropNoteId
			this.newCategoryDropNoteId = null
			if (!trimmed) {
				return
			}
			const exists = this.categories.some((category) => category.name === trimmed)
			if (!exists) {
				store.notes.addLocalCategory(trimmed)
			}
			this.selectCategory(trimmed)
			if (droppedNoteId !== null) {
				setCategory(droppedNoteId, trimmed).catch(() => {})
			}
		},

		getNotesInCategory(category) {
			return store.notes.notes.filter((note) => note.category === category || note.category.startsWith(category + '/'))
		},

		updateNotesForCategoryRename(oldCategory, newCategory) {
			for (const note of store.notes.notes) {
				if (note.category === oldCategory || note.category.startsWith(oldCategory + '/')) {
					const updatedCategory = note.category.startsWith(oldCategory + '/')
						? newCategory + note.category.slice(oldCategory.length)
						: newCategory
					store.notes.setNoteAttribute({ noteId: note.id, attribute: 'category', value: updatedCategory })
				}
			}
		},

		removeNotesFromCategory(categoryName) {
			for (const note of this.getNotesInCategory(categoryName)) {
				store.notes.removeNote(note.id)
			}
		},

		updateSelectedCategoryForRename(oldCategory, newCategory) {
			const selected = this.selectedCategory
			if (selected === oldCategory) {
				this.selectCategory(newCategory)
				return
			}
			if (selected && selected.startsWith(oldCategory + '/')) {
				this.selectCategory(newCategory + selected.slice(oldCategory.length))
			}
		},

		clearSelectedCategoryForDelete(category) {
			const selected = this.selectedCategory
			if (selected === category || (selected && selected.startsWith(category + '/'))) {
				this.selectCategory(null)
			}
		},

		/* Moving a category is a rename: the backend carries its notes and its
		   descendants along, and refuses a move into its own subtree. */
		async moveCategory(dragged, target) {
			if (dragged === null) {
				return
			}
			const moved = categoryDropTarget(dragged, target)
			if (moved === null) {
				return
			}
			await this.onRenameCategory(dragged, moved)
		},

		async onRenameCategory(category, newCategory) {
			const trimmed = newCategory?.trim() ?? ''
			if (!trimmed || trimmed === category) {
				return
			}

			try {
				const response = await renameCategoryRequest(category, trimmed)
				const oldName = category
				const newName = response?.newCategory || trimmed
				this.updateNotesForCategoryRename(oldName, newName)
				store.notes.renameLocalCategory({ oldCategory: oldName, newCategory: newName })
				this.updateSelectedCategoryForRename(oldName, newName)
			} catch {
				// NotesService already shows a toast on failure.
			}
		},

		async onDeleteCategory(categoryName) {
			const notes = this.getNotesInCategory(categoryName)
			if (notes.length > 0) {
				let confirmed
				const message = this.n(
					'notes',
					'Delete category "{category}" and its {count} note?',
					'Delete category "{category}" and its {count} notes?',
					notes.length,
					{ category: this.categoryTitle(categoryName), count: notes.length },
				)
				try {
					confirmed = await showConfirmation({
						name: this.t('notes', 'Delete category'),
						text: message,
						labelConfirm: this.t('notes', 'Delete'),
						labelReject: this.t('notes', 'Cancel'),
						severity: 'warning',
					})
				} catch {
					confirmed = window.confirm(message)
				}
				if (!confirmed) {
					return
				}
			}

			try {
				await deleteCategoryRequest(categoryName)
				const deletedCategory = categoryName
				await this.closeOpenNoteBeforeDelete(deletedCategory)
				this.removeNotesFromCategory(deletedCategory)
				store.notes.removeLocalCategory(deletedCategory)
				this.clearSelectedCategoryForDelete(deletedCategory)
			} catch {
				// NotesService already shows a toast on failure.
			}
		},

		onCategoryDragOver(category, event) {
			/* Categories are nested, so this bubbles to every ancestor. The one
			   actually under the pointer is the innermost, which is where the
			   drop lands too. */
			event.stopPropagation()
			if (isCategoryDrag(event)) {
				const dragged = getDraggedCategory(event)
				if (dragged === null || categoryDropTarget(dragged, category) === null) {
					this.dragOverCategory = null
					return
				}
				event.preventDefault()
				this.dragOverAllNotes = false
				this.dragOverCategory = category
				return
			}
			if (!isNoteDrag(event)) {
				this.dragOverCategory = null
				this.dragOverAllNotes = false
				return
			}
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move'
			}
			this.dragOverAllNotes = false
			this.dragOverCategory = category
		},

		onAllNotesDragOver(event) {
			if (isCategoryDrag(event)) {
				const dragged = getDraggedCategory(event)
				if (dragged === null || categoryDropTarget(dragged, null) === null) {
					this.dragOverAllNotes = false
					return
				}
				event.preventDefault()
				this.dragOverCategory = null
				this.dragOverAllNotes = true
				return
			}
			if (!isNoteDrag(event)) {
				this.dragOverCategory = null
				this.dragOverAllNotes = false
				return
			}
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move'
			}
			this.dragOverCategory = null
			this.dragOverAllNotes = true
		},

		onAllNotesDragLeave(event) {
			if (!this.dragOverAllNotes) {
				return
			}

			const currentTarget = event.currentTarget
			const relatedTarget = event.relatedTarget
			if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
				return
			}

			this.dragOverAllNotes = false
		},

		onCategoryDragLeave(category, event) {
			event.stopPropagation()
			if (this.dragOverCategory !== category) {
				return
			}

			const currentTarget = event.currentTarget
			const relatedTarget = event.relatedTarget
			if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
				return
			}

			this.dragOverCategory = null
		},

		async onAllNotesDrop(event) {
			event.preventDefault()
			event.stopPropagation()

			this.dragOverAllNotes = false

			if (isCategoryDrag(event)) {
				await this.moveCategory(getDraggedCategory(event), null)
				return
			}

			const noteId = getDraggedNoteId(event, (noteId) => store.notes.getNote(noteId))
			if (noteId === null) {
				return
			}

			const note = store.notes.getNote(noteId)
			if (!note || note.category === '') {
				return
			}

			await setCategory(noteId, '')
		},

		async onCategoryDrop(category, event) {
			event.preventDefault()
			event.stopPropagation()

			this.dragOverCategory = null
			this.dragOverAllNotes = false

			if (isCategoryDrag(event)) {
				await this.moveCategory(getDraggedCategory(event), category)
				return
			}

			const noteId = getDraggedNoteId(event, (noteId) => store.notes.getNote(noteId))
			if (noteId === null) {
				return
			}

			const note = store.notes.getNote(noteId)
			if (!note || note.category === category) {
				return
			}

			await setCategory(noteId, category)
		},

		onSelectCategory(category) {
			this.selectCategory(category)
		},

		selectCategory(category) {
			this.$router.push(categoryRoute(this.$route, category)).catch(() => {})
		},

		async closeOpenNoteBeforeDelete(categoryName) {
			const noteId = Number.parseInt(this.$route?.params?.noteId, 10)
			if (!Number.isFinite(noteId)) {
				return
			}
			const note = store.notes.getNote(noteId)
			if (!note) {
				return
			}
			if (note.category === categoryName || note.category.startsWith(categoryName + '/')) {
				const remainingNote = store.notes.notes.find((other) => (
					other.id !== noteId
					&& other.category !== categoryName
					&& !other.category.startsWith(categoryName + '/')
				))
				if (remainingNote) {
					await this.$router.push({
						name: 'note',
						params: { noteId: remainingNote.id.toString() },
						query: keepCategory(this.$route),
					}).catch(() => {})
				} else {
					await this.$router.push({ name: 'welcome', query: keepCategory(this.$route) }).catch(() => {})
				}
			}
		},

		onCategoryDragStart(category, event) {
			if (category === '' || !event.dataTransfer) {
				event.preventDefault()
				return
			}
			event.stopPropagation()
			event.dataTransfer.effectAllowed = 'move'
			event.dataTransfer.setData(CATEGORY_DRAG_TYPE, category)
		},
	},
}
</script>

<style lang="scss" scoped>
.app-navigation-entry-wrapper.active:deep(.app-navigation-entry) {
	background-color: var(--color-primary-element) !important;
}

.app-navigation-entry-wrapper.active:deep(.app-navigation-entry:hover),
.app-navigation-entry-wrapper.active:deep(.app-navigation-entry:focus-within) {
	background-color: var(--color-primary-element-hover) !important;
}

.app-navigation-entry-wrapper.drop-over:deep(> .app-navigation-entry) {
	background-color: var(--color-primary-element) !important;
	outline: 2px dashed var(--color-primary-element-text);
	outline-offset: -2px;
	border-radius: var(--border-radius-element, var(--border-radius-large));
}

.app-navigation-caption.drop-over-caption {
	background-color: var(--color-primary-element-light) !important;
	outline: 2px dashed var(--color-primary-element);
	outline-offset: -2px;
	border-radius: var(--border-radius-element, var(--border-radius-large));
}

.app-navigation-entry-wrapper.active:deep(.app-navigation-entry-link),
.app-navigation-entry-wrapper.active:deep(.app-navigation-entry-button),
.app-navigation-entry-wrapper.active:deep(.material-design-icon),
.app-navigation-entry-wrapper.drop-over:deep(> .app-navigation-entry .app-navigation-entry-link),
.app-navigation-entry-wrapper.drop-over:deep(> .app-navigation-entry .app-navigation-entry-button),
.app-navigation-entry-wrapper.drop-over:deep(> .app-navigation-entry .material-design-icon) {
	color: var(--color-primary-element-text) !important;
}

/* 22px is the counter bubble's diameter, so this centres a single-digit
   bubble under the caption's icon. */
.app-navigation-entry-wrapper:deep(.app-navigation-entry__utils) {
	--counter-inset: calc((var(--default-clickable-area) - 22px) / 2);
	position: relative;
}

.app-navigation-entry-wrapper:deep(.app-navigation-entry__utils .app-navigation-entry__counter-wrapper) {
	margin-inline-end: var(--counter-inset);
	transition: margin-inline-end var(--animation-quick) ease-in-out;
}

/* Out of the flow, so revealing it lets the counter animate aside instead of
   being displaced instantly. */
.app-navigation-entry-wrapper:deep(.app-navigation-entry__utils .action-item.app-navigation-entry__actions) {
	position: absolute;
	inset-inline-end: 0;
}

.app-navigation-entry-wrapper:not(.category-no-actions):deep(.app-navigation-entry:hover .app-navigation-entry__counter-wrapper),
.app-navigation-entry-wrapper:not(.category-no-actions):deep(.app-navigation-entry:focus-within .app-navigation-entry__counter-wrapper),
.app-navigation-entry-wrapper:not(.category-no-actions):deep(.app-navigation-entry.active .app-navigation-entry__counter-wrapper) {
	margin-inline-end: calc(var(--counter-inset) + var(--default-clickable-area));
}

@media (prefers-reduced-motion: reduce) {
	.app-navigation-entry-wrapper:deep(.app-navigation-entry__utils .app-navigation-entry__counter-wrapper) {
		transition: none;
	}
}
</style>
