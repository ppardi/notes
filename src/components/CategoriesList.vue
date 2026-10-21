<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<!-- The plus stays a plus now that it opens a menu: without its own
	     trigger icon it would fall back to an anonymous "..." -->
	<NavigationSectionHeading v-show="!loading"
		:name="t('notes', 'Categories')"
		:collapsed="collapsed"
		:actionsAriaLabel="t('notes', 'Add category')"
		:class="{ 'drop-over-caption': dragOverNewCategory }"
		@toggle="toggleSection"
		@dragover="onNewCategoryDragOver($event)"
		@dragleave="onNewCategoryDragLeave($event)"
		@drop="onNewCategoryDrop($event)"
	>
		<template #actionsTriggerIcon>
			<FolderPlusIcon :size="20" />
		</template>
		<template v-if="!hideNewCategoryAction" #actions>
			<NcActionButton :closeAfterClick="true" @click="startNewCategory()">
				<template #icon>
					<FolderPlusIcon :size="20" />
				</template>
				{{ t('notes', 'New category') }}
			</NcActionButton>
			<NcActionButton :closeAfterClick="true" @click="startNewSmartCategory('')">
				<template #icon>
					<FolderPoundOutlineIcon :size="20" />
				</template>
				{{ t('notes', 'New smart category') }}
			</NcActionButton>
		</template>
	</NavigationSectionHeading>

	<template v-if="!collapsed">
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

		<template v-for="node in categoryTree" :key="node.smart ? `smart:${node.id}` : node.name">
			<SmartCategoryTreeItem v-if="node.smart"
				:node="node"
				:loading="loading"
				:selectedSmartId="selectedSmartId"
			/>
			<CategoryTreeItem v-else
				:node="node"
				:loading="loading"
				:selectedCategory="selectedCategory"
				:selectedSmartId="selectedSmartId"
				:dragOverCategory="dragOverCategory"
				:dropBesideCategory="dropBesideCategory"
				:dropBesideSide="dropBesideSide"
				:draftParent="newCategoryParent"
				:collapsedCategories="collapsedCategories"
			/>
		</template>
	</template>

	<SmartCategoryDialog :open="smartDialogOpen"
		:smartCategory="smartDialogRecord"
		:parent="smartDialogParent"
		@update:open="smartDialogOpen = $event"
		@save="onSaveSmart"
	/>
</template>

<script>
import { showConfirmation } from '@nextcloud/dialogs'
import { subscribe, unsubscribe } from '@nextcloud/event-bus'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import FolderIcon from 'vue-material-design-icons/Folder.vue'
import FolderPlusIcon from 'vue-material-design-icons/FolderPlusOutline.vue'
import FolderPoundOutlineIcon from 'vue-material-design-icons/FolderPoundOutline.vue'
import CategoryTreeItem from './CategoryTreeItem.vue'
import NavigationSectionHeading from './NavigationSectionHeading.vue'
import SmartCategoryDialog from './SmartCategoryDialog.vue'
import SmartCategoryTreeItem from './SmartCategoryTreeItem.vue'
import { orderKey, pruneOnDelete, rekeyOnRename, SMART_PREFIX, withKeyAt } from '../categoryOrder.js'
import { categoryAncestors, categoryDropTarget, categoryNames, joinCategory, landingCategory, pruneCollapsed, withCategoriesExpanded, withCategoryCollapsed, withSmartCategories } from '../categoryTree.js'
import { SECTION_CATEGORIES } from '../navigationSections.js'
import { createCategory as createCategoryRequest, deleteCategory as deleteCategoryRequest, renameCategory as renameCategoryRequest, setCategory, setSettings } from '../NotesService.js'
import { sectionCollapse } from '../sectionCollapse.js'
import { reparentOnDelete, reparentOnRename } from '../smartCategories.js'
import store from '../store.js'
import { CATEGORY_DRAG_TYPE, categoryLabel, categoryRoute, getDraggedCategory, getDraggedNoteId, getDraggedSmart, isCategoryDrag, isNoteDrag, isSmartDrag, keepSelection, SMART_DRAG_TYPE, smartFromQuery, smartRoute } from '../Util.js'

export default {
	name: 'CategoriesList',

	components: {
		CategoryTreeItem,
		NavigationSectionHeading,
		SmartCategoryDialog,
		SmartCategoryTreeItem,
		NcActionButton,
		NcAppNavigationItem,
		NcCounterBubble,
		FolderIcon,
		FolderPlusIcon,
		FolderPoundOutlineIcon,
	},

	mixins: [sectionCollapse(SECTION_CATEGORIES)],

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
				selectSmart: (id) => this.onSelectSmart(id),
				setSmartRef: (id, el) => this.setSmartItemRef(id, el),
				startRenameSmart: (id) => this.smartItems[id]?.handleEdit?.(),
				renameSmart: (id, name) => this.onRenameSmart(id, name),
				editSmart: (id) => this.onEditSmart(id),
				removeSmart: (id) => this.onRemoveSmart(id),
				smartDragStart: (id, event) => this.onSmartDragStart(id, event),
				clearDropMarks: () => this.clearCategoryDropMarks(),
				startSubSmartCategory: (name) => this.startNewSmartCategory(name),
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
			draggedSmart: null,
			dropBesideCategory: null,
			dropBesideSide: 'before',
			dragOverNewCategory: false,
			newCategoryDraft: false,
			newCategoryParent: null,
			newCategoryItem: null,
			newCategoryMonitor: null,
			newCategoryDropNoteId: null,
			categoryItems: {},
			smartItems: {},
			smartDialogOpen: false,
			smartDialogRecord: null,
			smartDialogParent: '',
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
			return withSmartCategories(
				this.categories,
				this.smartCategories,
				/* The same reading the note list gives, so the number on the row
				   always describes the list the row opens. */
				(smart) => store.notes.countNotesWithTags(smart.tags, smart.mode),
				this.categoryOrder,
			)
		},

		smartCategories() {
			return store.app.settings?.smartCategories ?? []
		},

		categoryOrder() {
			return store.app.settings?.categoryOrder ?? []
		},

		selectedSmartId() {
			return smartFromQuery(this.$route.query)
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

		setSmartItemRef(id, el) {
			if (el) {
				this.smartItems[id] = el
			} else {
				delete this.smartItems[id]
			}
		},

		onSelectSmart(id) {
			this.$router.push(smartRoute(this.$route, id)).catch(() => {})
		},

		startNewSmartCategory(parent) {
			this.smartDialogRecord = null
			this.smartDialogParent = parent ?? ''
			this.smartDialogOpen = true
		},

		/**
		 * Store a smart category, replacing the record with the same id.
		 *
		 * @param {object} smart the record from the dialog
		 */
		async onSaveSmart(smart) {
			const existing = this.smartCategories.findIndex((entry) => entry.id === smart.id)
			const isNew = existing < 0
			const smartCategories = isNew
				? [...this.smartCategories, smart]
				: this.smartCategories.map((entry, at) => (at === existing ? smart : entry))
			let saved
			try {
				saved = await setSettings({ smartCategories })
			} catch {
				// NotesService already shows a toast on failure.
				return
			}
			/* Only a new one opens. It was made from what the dialog was
			   showing, so a row that sat there unlit read as a save that had
			   not taken. An edit is not new: its row is reachable from wherever
			   you happen to be, so opening it would yank the note list away
			   from what was being read and leave a history entry behind. */
			if (!isNew) {
				return
			}
			/* The server normalizes what it is given and drops what it cannot
			   use, so what came back is what exists - routing to an id it threw
			   away would land on the "this has gone" path with no explanation. */
			if (!(saved.smartCategories ?? []).some((entry) => entry.id === smart.id)) {
				return
			}
			this.$router.push(smartRoute(this.$route, smart.id)).catch(() => {})
		},

		onEditSmart(id) {
			const smart = this.smartCategories.find((entry) => entry.id === id)
			if (!smart) {
				return
			}
			this.smartDialogRecord = smart
			this.smartDialogParent = smart.parent
			this.smartDialogOpen = true
		},

		async onRenameSmart(id, name) {
			const trimmed = (name ?? '').trim()
			const smart = this.smartCategories.find((entry) => entry.id === id)
			if (!smart || trimmed === '' || trimmed === smart.name) {
				return
			}
			try {
				await setSettings({
					smartCategories: this.smartCategories.map((entry) => (
						entry.id === id ? { ...entry, name: trimmed } : entry
					)),
				})
			} catch {
				// NotesService already shows a toast on failure.
			}
		},

		/* No confirmation: it holds no notes of its own, and making it again is
		   the same two clicks it took the first time. */
		async onRemoveSmart(id) {
			try {
				await setSettings({
					smartCategories: this.smartCategories.filter((entry) => entry.id !== id),
				})
			} catch {
				// NotesService already shows a toast on failure.
				return
			}
			/* Deleting what the list is showing would otherwise leave the app on
			   a selection that no longer exists. */
			if (this.selectedSmartId === id) {
				const category = landingCategory(this.categories)
				this.$router.replace(categoryRoute(this.$route, category)).catch(() => {})
			}
		},

		onSmartDragStart(id, event) {
			if (!event.dataTransfer) {
				event.preventDefault()
				return
			}
			event.stopPropagation()
			event.dataTransfer.effectAllowed = 'move'
			event.dataTransfer.setData(SMART_DRAG_TYPE, id)
			this.draggedSmart = id
		},

		/**
		 * File a smart category somewhere else.
		 *
		 * Nothing about what it holds changes - the tags decide that. This only
		 * moves the row.
		 *
		 * @param {string} id the record being moved
		 * @param {string} parent the category to file it under, '' for the top
		 */
		/* A smart category dropped on a row: which group it joins, and where in
		   it. It is arranged alongside the folder categories, so a drop has to
		   record its key as well as change its parent - a parent alone would
		   leave it sorting by name among rows that no longer do. */
		async moveSmartTo(id, category, side) {
			const key = SMART_PREFIX + id
			const separator = category.lastIndexOf('/')
			const parent = side === 'into'
				? category
				: (separator === -1 ? '' : category.slice(0, separator))

			const rest = this.groupKeys(parent === '' ? null : parent).filter((candidate) => candidate !== key)
			const at = side === 'into' ? -1 : rest.indexOf(category)
			// nesting has no slot to aim at, so it lands where anything unplaced does
			const index = at < 0 ? 0 : (side === 'after' ? at + 1 : at)

			await this.moveSmart(id, parent, withKeyAt(this.categoryOrder, [...rest, key], key, index))
		},

		async moveSmart(id, parent, categoryOrder = null) {
			const smart = this.smartCategories.find((entry) => entry.id === id)
			if (!smart) {
				return
			}
			/* Both halves in one write: the parent may be unchanged when only
			   the arrangement moved, and the arrangement may be absent when the
			   caller only wanted a reparent. */
			const settings = {
				...(smart.parent === parent
					? {}
					: {
						smartCategories: this.smartCategories.map((entry) => (
							entry.id === id ? { ...entry, parent } : entry
						)),
					}),
				...(categoryOrder ? { categoryOrder } : {}),
			}
			if (Object.keys(settings).length === 0) {
				return
			}
			try {
				await setSettings(settings)
			} catch {
				// NotesService already shows a toast on failure.
			}
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

		async startNewCategory(payload = {}) {
			if (this.newCategoryDraft) {
				return
			}
			/* The draft row lives inside the section. With the section shut it
			   is never rendered, so the editing monitor waits on a row that
			   cannot arrive and every later attempt is refused by the guard
			   above - making a category dead for the rest of the session, and
			   losing a note dropped on the heading along the way.

			   Awaited, because the row can only be reached for editing once the
			   stored setting has come back and the section has drawn itself. */
			if (this.collapsed) {
				await this.setSectionCollapsed(false)
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

		async onCreateCategory(newCategory) {
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
			let stored = name
			const exists = this.categories.some((category) => category.name === name)
			if (!exists) {
				/* A category is a folder, and one that holds no notes has nothing
				   else to bring it into being. Until the folder is there the
				   category cannot be moved, renamed or reloaded, so nothing goes
				   in the sidebar until the server has it - under the name the
				   server made, which drops what a folder name cannot hold. */
				try {
					const created = await createCategoryRequest(name)
					stored = created?.category || name
				} catch {
					// NotesService already shows a toast on failure.
					return
				}
				store.notes.addLocalCategory(stored)
				await this.recordNewCategory(stored)
			}
			this.selectCategory(stored)
			if (droppedNoteId !== null) {
				setCategory(droppedNoteId, stored).catch(() => {})
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
			this.draggedSmart = null
			this.clearCategoryDropMarks()
		},

		clearCategoryDropMarks() {
			this.dragOverCategory = null
			this.dropBesideCategory = null
		},

		/* Where a category dropped on a row's edge would land: the group it
		   joins, and the path it would take there - null when it is already in
		   that group and only its place in the arrangement changes. */
		slotTarget(dragged, row) {
			if (dragged === null || row === '') {
				return null
			}
			const parentOf = (path) => {
				const separator = path.lastIndexOf('/')
				return separator === -1 ? null : path.slice(0, separator)
			}
			const parent = parentOf(row)
			if (parent === parentOf(dragged)) {
				return { parent, moved: null }
			}
			const moved = categoryDropTarget(dragged, parent)
			return moved === null ? null : { parent, moved }
		},

		/* The keys of one group, as the tree is showing it. The unfiled
		   category is never arranged, so it never contributes one. */
		groupKeys(parent) {
			const find = (level) => {
				for (const node of level) {
					if (!node.smart && node.name === parent) {
						return node.children
					}
					const deeper = find(node.children ?? [])
					if (deeper !== null) {
						return deeper
					}
				}
				return null
			}
			const level = parent === null ? this.categoryTree : (find(this.categoryTree) ?? [])
			return level.map(orderKey).filter((key) => key !== '')
		},

		/* A category somebody has just made goes to the top of its group: it is
		   the one they are looking for, and the top is where anything the
		   arrangement does not yet place already appears. */
		async recordNewCategory(category) {
			const separator = category.lastIndexOf('/')
			const parent = separator === -1 ? null : category.slice(0, separator)
			const rest = this.groupKeys(parent).filter((key) => key !== category)
			try {
				await setSettings({
					categoryOrder: withKeyAt(this.categoryOrder, [...rest, category], category, 0),
				})
			} catch {
				// NotesService already shows a toast on failure.
			}
		},

		/* A rename that changes the parent carries the key into a group where
		   its old index means nothing, so it is placed at the top instead. A
		   rename within one group keeps the place it had. */
		reslotIfMoved(order, oldName, newName) {
			const parentOf = (path) => {
				const separator = path.lastIndexOf('/')
				return separator === -1 ? null : path.slice(0, separator)
			}
			if (parentOf(oldName) === parentOf(newName)) {
				return order
			}
			const parent = parentOf(newName)
			const rest = this.groupKeys(parent).filter((key) => key !== oldName && key !== newName)
			return withKeyAt(order, [...rest, newName], newName, 0)
		},

		async moveCategoryBeside(dragged, row, side) {
			const target = this.slotTarget(dragged, row)
			if (target === null) {
				return
			}
			const { parent, moved } = target

			const rest = this.groupKeys(parent).filter((key) => key !== dragged)
			const at = rest.indexOf(row)
			if (at < 0) {
				return
			}
			const index = side === 'after' ? at + 1 : at

			if (moved === null) {
				/* Already in this group, so nothing moves on disk and there is
				   nothing to ask the server to do: the arrangement is the whole
				   change. */
				try {
					await setSettings({
						categoryOrder: withKeyAt(this.categoryOrder, [...rest, dragged], dragged, index),
					})
				} catch {
					// NotesService already shows a toast on failure.
				}
				return
			}

			/* The folder moves first, because that is the half that can fail
			   for reasons outside this app. The arrangement follows in the
			   settings write the rename already makes. */
			await this.onRenameCategory(dragged, moved, (newName) => ({
				categoryOrder: withKeyAt(
					rekeyOnRename(this.categoryOrder, dragged, newName) ?? this.categoryOrder,
					[...rest, newName],
					newName,
					index,
				),
			}))
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

		async onRenameCategory(category, newCategory, settingsFor = null) {
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
				const rekeyed = rekeyOnRename(this.categoryOrder, oldName, newName)
				const followed = reparentOnRename(this.smartCategories, oldName, newName)
				/* One write, not two: the settings blob is read, changed and
				   written whole, so a second call would race the first. */
				const settings = {
					...(rekeyed !== null ? { categoryOrder: this.reslotIfMoved(rekeyed, oldName, newName) } : {}),
					...(followed !== null ? { smartCategories: followed } : {}),
					/* Last, because a drop has already worked out the slot it
					   aimed at and that beats anything inferred here. */
					...(settingsFor ? settingsFor(newName) : {}),
				}
				if (Object.keys(settings).length > 0) {
					await setSettings(settings)
				}
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
				/* It holds no notes of its own, so deleting the folder it was
				   filed in is no reason to destroy it. */
				const pruned = pruneOnDelete(this.categoryOrder, deletedCategory)
				const moved = reparentOnDelete(this.smartCategories, deletedCategory)
				/* A smart category inside the deleted folder is lifted to the
				   grandparent rather than deleted, so its key survives the
				   prune and lands in a group where its old place means
				   nothing. It goes to the top, where anything unplaced goes. */
				const lifted = (moved ?? []).filter((entry, at) => entry.parent !== this.smartCategories[at]?.parent)
				const order = lifted.reduce(
					(carried, entry) => withKeyAt(
						carried,
						[...this.groupKeys(entry.parent === '' ? null : entry.parent), SMART_PREFIX + entry.id],
						SMART_PREFIX + entry.id,
						0,
					),
					pruned ?? this.categoryOrder,
				)
				const settings = {
					...(pruned !== null || lifted.length > 0 ? { categoryOrder: order } : {}),
					...(moved !== null ? { smartCategories: moved } : {}),
				}
				if (Object.keys(settings).length > 0) {
					await setSettings(settings)
				}
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
			if (isSmartDrag(event)) {
				/* The unfiled category is not a folder, so it takes no children
				   - the same rule a real category follows. */
				if (category === '') {
					this.clearCategoryDropMarks()
					return
				}
				event.preventDefault()
				this.dropBesideCategory = null
				this.dragOverCategory = category
				return
			}
			if (isCategoryDrag(event)) {
				const dragged = this.draggedCategory ?? getDraggedCategory(event)
				const side = this.categoryDropSide(event)
				/* A slot at the dragged category's own level is valid even
				   though nothing moves on disk: it is an arrangement, and
				   refusing it is what used to make the line flicker out
				   wherever a category was dropped among its own siblings. */
				const valid = side === 'into'
					? categoryDropTarget(dragged, category) !== null
					: this.slotTarget(dragged, category) !== null
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

			if (isSmartDrag(event)) {
				const dragged = getDraggedSmart(event) || this.draggedSmart
				this.draggedSmart = null
				/* The same guard the dragover has: the unfiled category is not a
				   folder, so it takes no children. Both branches carry it, or
				   the one without it is the one that survives a later edit. */
				if (dragged && category !== '') {
					/* A row's middle files it inside; its edges file it at that
					   row's own level, the same as a real category. */
					await this.moveSmartTo(dragged, category, this.categoryDropSide(event))
				}
				return
			}

			if (isCategoryDrag(event)) {
				// an empty answer means the browser withheld it, not the unfiled category
				const dragged = getDraggedCategory(event) || this.draggedCategory
				const side = this.categoryDropSide(event)
				if (side === 'into') {
					await this.moveCategory(dragged, category)
				} else {
					await this.moveCategoryBeside(dragged, category, side)
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
