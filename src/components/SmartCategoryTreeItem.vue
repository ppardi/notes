<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcAppNavigationItem
		v-show="!loading"
		:ref="(el) => tree.setSmartRef(node.id, el)"
		:name="node.name"
		:active="node.id === selectedSmartId"
		:draggable="true"
		:editPlaceholder="node.name"
		:title="describe"
		forceMenu
		class="smart-category-entry"
		@click.prevent.stop="tree.selectSmart(node.id)"
		@dragstart="tree.smartDragStart(node.id, $event)"
		@dragend="tree.dragEnd()"
		@dragover="onDragOver"
		@drop="onDrop"
		@update:name="tree.renameSmart(node.id, $event)"
	>
		<template #icon>
			<FolderPoundIcon v-if="node.id === selectedSmartId" :size="20" />
			<FolderPoundOutlineIcon v-else :size="20" />
		</template>
		<template #counter>
			<NcCounterBubble :count="node.count" />
		</template>
		<template #actions>
			<NcActionButton :closeAfterClick="true" @click="tree.editSmart(node.id)">
				<template #icon>
					<TagMultipleOutlineIcon :size="20" />
				</template>
				{{ t('notes', 'Edit tags') }}
			</NcActionButton>
			<NcActionButton :closeAfterClick="true" @click="tree.startRenameSmart(node.id)">
				<template #icon>
					<PencilOutlineIcon :size="20" />
				</template>
				{{ t('notes', 'Rename smart category') }}
			</NcActionButton>
			<NcActionButton :closeAfterClick="true" @click="tree.removeSmart(node.id)">
				<template #icon>
					<DeleteOutlineIcon :size="20" />
				</template>
				{{ t('notes', 'Delete smart category') }}
			</NcActionButton>
		</template>
	</NcAppNavigationItem>
</template>

<script>
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import DeleteOutlineIcon from 'vue-material-design-icons/DeleteOutline.vue'
import FolderPoundIcon from 'vue-material-design-icons/FolderPound.vue'
import FolderPoundOutlineIcon from 'vue-material-design-icons/FolderPoundOutline.vue'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'
import TagMultipleOutlineIcon from 'vue-material-design-icons/TagMultipleOutline.vue'

export default {
	name: 'SmartCategoryTreeItem',

	components: {
		DeleteOutlineIcon,
		FolderPoundIcon,
		FolderPoundOutlineIcon,
		NcActionButton,
		NcAppNavigationItem,
		NcCounterBubble,
		PencilOutlineIcon,
		TagMultipleOutlineIcon,
	},

	/* The handlers come from CategoriesList through provide/inject, the same
	   way the real categories get theirs. */
	inject: ['tree'],

	props: {
		node: {
			type: Object,
			required: true,
		},

		loading: Boolean,

		selectedSmartId: {
			type: String,
			default: null,
		},
	},

	computed: {
		/* What it is looking for, for the row's tooltip. */
		describe() {
			const tags = this.node.tags.map((tag) => `#${tag}`).join(' ')
			return this.node.mode === 'all' && this.node.tags.length > 1
				? t('notes', 'Notes with all of: {tags}', { tags })
				: tags
		},
	},

	methods: {
		/* Refused rather than ignored: without stopping it here the drop
		   bubbles to the category this row happens to sit in, and the note is
		   filed somewhere the pointer never was. Not calling preventDefault is
		   what tells the browser the drop is not allowed. */
		onDragOver(event) {
			event.stopPropagation()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'none'
			}
			/* The category this row sits in keeps its own highlight otherwise:
			   its dragleave never fires, because the pointer is still inside
			   it — so it would go on saying "drop here" over a row that is
			   about to refuse the drop. */
			this.tree.clearDropMarks()
		},

		onDrop(event) {
			event.stopPropagation()
			event.preventDefault()
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
