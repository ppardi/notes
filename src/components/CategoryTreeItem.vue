<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcAppNavigationItem
		v-show="!loading"
		:ref="(el) => tree.setItemRef(node.name, el)"
		:name="displayName"
		:active="node.name === selectedCategory"
		:draggable="node.name !== ''"
		:editPlaceholder="node.label"
		:forceMenu="node.name !== ''"
		:allowCollapse="hasChildren"
		:open="isOpen"
		:class="{
			'drop-over': node.name === dragOverCategory,
			'drop-before': node.name === dropBesideCategory && dropBesideSide === 'before',
			'drop-after': node.name === dropBesideCategory && dropBesideSide === 'after',
			'category-no-actions': node.name === '',
		}"
		@update:open="tree.setOpen(node.name, $event)"
		@click.prevent.stop="tree.select(node.name)"
		@dragstart="tree.dragStart(node.name, $event)"
		@dragend="tree.dragEnd()"
		@dragover="tree.dragOver(node.name, $event)"
		@dragleave="tree.dragLeave(node.name, $event)"
		@drop="tree.drop(node.name, $event)"
		@update:name="tree.rename(node.name, $event)"
	>
		<template #icon>
			<FolderIcon v-if="node.name === selectedCategory" :size="20" />
			<FolderOutlineIcon v-else :size="20" />
		</template>
		<template #counter>
			<NcCounterBubble :count="node.count" />
		</template>
		<template v-if="node.name !== ''" #actions>
			<NcActionButton
				:closeAfterClick="true"
				@click="tree.startSubcategory(node.name)"
			>
				<template #icon>
					<FolderPlusIcon :size="20" />
				</template>
				{{ t('notes', 'New subcategory') }}
			</NcActionButton>
			<NcActionButton
				:closeAfterClick="true"
				@click="tree.startRename(node.name)"
			>
				<template #icon>
					<PencilOutlineIcon :size="20" />
				</template>
				{{ t('notes', 'Rename category') }}
			</NcActionButton>
			<NcActionButton
				:closeAfterClick="true"
				@click="tree.remove(node.name)"
			>
				<template #icon>
					<DeleteIcon :size="20" />
				</template>
				{{ t('notes', 'Delete category') }}
			</NcActionButton>
		</template>

		<NcAppNavigationItem v-if="node.name === draftParent"
			:ref="(el) => tree.setDraftRef(el)"
			name=""
			:draggable="false"
			:editPlaceholder="t('notes', 'New category')"
			class="category-draft"
			@click.prevent.stop
			@update:name="tree.createCategory($event)"
		>
			<template #icon>
				<FolderIcon :size="20" />
			</template>
			<template #counter>
				<NcCounterBubble :count="0" />
			</template>
		</NcAppNavigationItem>

		<template v-for="child in node.children" :key="child.smart ? `smart:${child.id}` : child.name">
			<SmartCategoryTreeItem v-if="child.smart"
				:node="child"
				:loading="loading"
				:selectedSmartId="selectedSmartId"
			/>
			<CategoryTreeItem v-else
				:node="child"
				:loading="loading"
				:selectedCategory="selectedCategory"
				:selectedSmartId="selectedSmartId"
				:dragOverCategory="dragOverCategory"
				:dropBesideCategory="dropBesideCategory"
				:dropBesideSide="dropBesideSide"
				:draftParent="draftParent"
				:collapsedCategories="collapsedCategories"
			/>
		</template>
	</NcAppNavigationItem>
</template>

<script>
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FolderIcon from 'vue-material-design-icons/Folder.vue'
import FolderOutlineIcon from 'vue-material-design-icons/FolderOutline.vue'
import FolderPlusIcon from 'vue-material-design-icons/FolderPlusOutline.vue'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'
import SmartCategoryTreeItem from './SmartCategoryTreeItem.vue'

export default {
	name: 'CategoryTreeItem',

	components: {
		DeleteIcon,
		FolderIcon,
		FolderOutlineIcon,
		FolderPlusIcon,
		NcActionButton,
		NcAppNavigationItem,
		NcCounterBubble,
		PencilOutlineIcon,
		SmartCategoryTreeItem,
	},

	/* The handlers come from CategoriesList through provide/inject so that they
	   do not have to be passed down through every level of the tree. */
	inject: ['tree'],

	props: {
		node: {
			type: Object,
			required: true,
		},

		loading: Boolean,
		selectedCategory: {
			type: String,
			default: null,
		},

		selectedSmartId: {
			type: String,
			default: null,
		},

		dragOverCategory: {
			type: String,
			default: null,
		},

		dropBesideCategory: {
			type: String,
			default: null,
		},

		dropBesideSide: {
			type: String,
			default: 'before',
		},

		/* The category a new subcategory is being typed into, if any. */
		draftParent: {
			type: String,
			default: null,
		},

		collapsedCategories: {
			type: Array,
			required: true,
		},
	},

	computed: {
		displayName() {
			return this.node.name === '' ? t('notes', 'Unfiled') : this.node.label
		},

		hasChildren() {
			return this.node.children.length > 0 || this.node.name === this.draftParent
		},

		/* Open unless it was collapsed on purpose: a tree that starts closed
		   hides the hierarchy it exists to show. */
		isOpen() {
			/* A subcategory being typed is invisible inside a collapsed parent. */
			if (this.node.name === this.draftParent) {
				return true
			}
			return !this.collapsedCategories.includes(this.node.name)
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
