<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
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
		v-if="newCategoryDraft && newCategoryParent === null"
		v-show="!loading"
		:ref="(el) => setDraftRef(el)"
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
		:dropBesideCategory="dropBesideCategory"
		:dropBesideSide="dropBesideSide"
		:draftParent="newCategoryParent"
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
import CategoryTreeItem from './CategoryTreeItem.vue'
import { buildCategoryTree, categoryAncestors, categoryDropTarget, categoryNames, categorySiblingTarget, joinCategory, landingCategory, pruneCollapsed, withCategoriesExpanded, withCategoryCollapsed } from '../categoryTree.js'
import { deleteCategory as deleteCategoryRequest, renameCategory as renameCategoryRequest, setCategory, setSettings } from '../NotesService.js'
import store from '../store.js'
import { CATEGORY_DRAG_TYPE, categoryLabel, categoryRoute, getDraggedCategory, getDraggedNoteId, isCategoryDrag, isNoteDrag, keepSelection } from '../Util.js'

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
	},

	provide() {
		return {
			tree: {
				select: (name) => this.onSelectCategory(name),
				startRename: (name) => this.onStartRenameCategory(name),
				startSubcategory: (name) => this.startNewCategory({ parent: name }),
				createCategory: (name) => this.onCreateCategory(name),
				setDraftRef: (el) => this.setDraftRef(el),
				rename: (name, newName) => this.onRenameCategory(name, newName),
				remove: (name) => this.onDeleteCategory(name),
				dragStart: (name, event) => this.onCategoryDragStart(name, event),
				dragEnd: () => this.onCategoryDragEnd(),
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
			/* The drag data store is protected while a drag is over a target:
			   the types can be read but the data cannot, so the category being
			   dragged has to be remembered from the dragstart. */
			draggedCategory: null,
			dropBesideCategory: null,
			dropBesideSide: 'before',
			dragOverNewCategory: false,
			newCategoryDraft: false,
			newCategoryParent: null,
			newCategoryItem: null,
			newCategoryMonitor: null,
			newCategoryDropNoteId: null,
			categoryItems: {},
			collapsedCategories: [],
			collapsedLoaded: false,
		}
	},

	computed: {
		categories() {
			/* The unfiled category is always offered, even while empty. It is
			   where a note goes when it is dragged out of a category, so it has
			   to be there to drop onto. */
			const categories = store.notes.getCategories(0, true)
			return categories.some((category) => category.name === '')
				? categories
				: [{ name: '', count: 0 }, ...categories]
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

		setDraftRef(el) {
			this.newCategoryItem = el ?? null
		},

		startNewCategory(payload = {}) {
			if (this.newCategoryDraft) {
				return
			}
			const parent = payload?.parent ?? null
			this.newCategoryDropNoteId = payload?.noteId ?? null
			this.newCategoryParent = parent
			this.newCategoryDraft = true
			if (parent !== null) {
				this.revealCategory(parent)
			}
			this.$nextTick(() => {
				this.newCategoryItem?.handleEdit?.()
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
					this.newCategoryParent = null
					return
				}
				const item = this.newCategoryItem
				if (item && item.editingActive === false) {
					this.newCategoryDraft = false
					this.stopNewCategoryMonitor()
					this.newCategoryDropNoteId = null
					this.newCategoryParent = null
					return
				}
				this.newCategoryMonitor = requestAnimationFrame(check)
			}
			this.newCategoryMonitor = requestAnimationFrame(check)
		},

		onCreateCategory(newCategory) {
			const parent = this.newCategoryParent
			this.newCategoryDraft = false
			this.newCategoryParent = null
			this.stopNewCategoryMonitor()
			const droppedNoteId = this.newCategoryDropNoteId
			this.newCategoryDropNoteId = null
			const name = joinCategory(parent, newCategory)
			if (!name) {
				return
			}
			const exists = this.categories.some((category) => category.name === name)
			if (!exists) {
				store.notes.addLocalCategory(name)
			}
			this.selectCategory(name)
			if (droppedNoteId !== null) {
				setCategory(droppedNoteId, name).catch(() => {})
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
				this.selectCategory(landingCategory(this.categories))
			}
		},

		/* Moving a category is a rename: the backend carries its notes and its
		   descendants along, and refuses a move into its own subtree. */
		/* A row's middle nests, its edges place the category at that row's own
		   level. The tree is sorted by name, so an edge says which level the
		   category lands in, not where in the level it sits. */
		categoryDropSide(event) {
			const entry = event.currentTarget?.querySelector?.(':scope > .app-navigation-entry')
			const rect = entry?.getBoundingClientRect()
			if (!rect?.height) {
				return 'into'
			}
			const offset = (event.clientY - rect.top) / rect.height
			if (offset < 0.25) {
				return 'before'
			}
			if (offset > 0.75) {
				return 'after'
			}
			return 'into'
		},

		onCategoryDragEnd() {
			this.draggedCategory = null
			this.clearCategoryDropMarks()
		},

		clearCategoryDropMarks() {
			this.dragOverCategory = null
			this.dropBesideCategory = null
		},

		async moveCategoryBeside(dragged, row) {
			if (dragged === null) {
				return
			}
			const moved = categorySiblingTarget(dragged, row)
			if (moved === null) {
				return
			}
			await this.onRenameCategory(dragged, moved)
		},

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
				const dragged = this.draggedCategory ?? getDraggedCategory(event)
				const side = this.categoryDropSide(event)
				const valid = side === 'into'
					? categoryDropTarget(dragged, category) !== null
					: categorySiblingTarget(dragged, category) !== null
				if (dragged === null || !valid) {
					this.clearCategoryDropMarks()
					return
				}
				event.preventDefault()
				this.dragOverCategory = side === 'into' ? category : null
				this.dropBesideCategory = side === 'into' ? null : category
				this.dropBesideSide = side === 'into' ? 'before' : side
				return
			}
			if (!isNoteDrag(event)) {
				this.clearCategoryDropMarks()
				return
			}
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move'
			}
			this.dropBesideCategory = null
			this.dragOverCategory = category
		},

		onCategoryDragLeave(category, event) {
			event.stopPropagation()
			if (this.dragOverCategory !== category && this.dropBesideCategory !== category) {
				return
			}

			const currentTarget = event.currentTarget
			const relatedTarget = event.relatedTarget
			if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
				return
			}

			this.clearCategoryDropMarks()
		},

		async onCategoryDrop(category, event) {
			event.preventDefault()
			event.stopPropagation()

			this.clearCategoryDropMarks()

			if (isCategoryDrag(event)) {
				// an empty answer means the browser withheld it, not the unfiled category
				const dragged = getDraggedCategory(event) || this.draggedCategory
				if (this.categoryDropSide(event) === 'into') {
					await this.moveCategory(dragged, category)
				} else {
					await this.moveCategoryBeside(dragged, category)
				}
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
						query: keepSelection(this.$route),
					}).catch(() => {})
				} else {
					await this.$router.push({ name: 'welcome', query: keepSelection(this.$route) }).catch(() => {})
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
			this.draggedCategory = category
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';

.app-navigation-caption.drop-over-caption {
	background-color: var(--color-primary-element-light) !important;
	border-radius: var(--border-radius-element, var(--border-radius-large));
}
</style>
