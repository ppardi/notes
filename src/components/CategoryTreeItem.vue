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

		<CategoryTreeItem v-for="child in node.children"
			:key="child.name"
			:node="child"
			:loading="loading"
			:selectedCategory="selectedCategory"
			:dragOverCategory="dragOverCategory"
			:dropBesideCategory="dropBesideCategory"
			:dropBesideSide="dropBesideSide"
			:collapsedCategories="collapsedCategories"
		/>
	</NcAppNavigationItem>
</template>

<script>
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import DeleteIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FolderIcon from 'vue-material-design-icons/Folder.vue'
import FolderOutlineIcon from 'vue-material-design-icons/FolderOutline.vue'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'

export default {
	name: 'CategoryTreeItem',

	components: {
		DeleteIcon,
		FolderIcon,
		FolderOutlineIcon,
		NcActionButton,
		NcAppNavigationItem,
		NcCounterBubble,
		PencilOutlineIcon,
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
			return this.node.children.length > 0
		},

		/* Open unless it was collapsed on purpose: a tree that starts closed
		   hides the hierarchy it exists to show. */
		isOpen() {
			return !this.collapsedCategories.includes(this.node.name)
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
