<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<!-- Nothing at all until something is tagged: the navigation must not grow
	     a heading for a feature that has not been used yet. -->
	<template v-if="tags.length > 0">
		<NcAppNavigationCaption v-show="!loading"
			:name="t('notes', 'Tags')"
			:inline="1"
		/>

		<NcAppNavigationItem v-for="tag in tags"
			v-show="!loading"
			:key="tag.name"
			:ref="(el) => setTagRef(tag.name, el)"
			:name="tag.name"
			:active="selectedTags.includes(tag.name)"
			:editPlaceholder="tag.name"
			forceMenu
			class="tag-entry"
			@click.prevent.stop="onSelect(tag.name)"
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
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import PencilOutlineIcon from 'vue-material-design-icons/PencilOutline.vue'
import PoundIcon from 'vue-material-design-icons/Pound.vue'
import { fetchNotes, renameTag } from '../NotesService.js'
import store from '../store.js'
import { tagsRoute } from '../Util.js'

export default {
	name: 'TagsList',

	components: {
		NcActionButton,
		NcAppNavigationCaption,
		NcAppNavigationItem,
		NcCounterBubble,
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
			await renameTag(from, to)
			await fetchNotes()
			/* Following the selection matters: without it the list would empty
			   itself as the notes left the tag being renamed, which reads as
			   data loss rather than a rename. */
			if (this.selectedTags.includes(from)) {
				const following = this.selectedTags.map((tag) => (tag === from ? to : tag))
				this.$router.push(tagsRoute(this.$route, [...new Set(following)], store.notes.getTagMode()))
			}
		},

		onSelect(tag) {
			/* The route owns the selection, so that it survives a reload and
			   moves with the browser's history — and it drops the category,
			   because a tag and a category are alternatives. */
			this.$router.push(tagsRoute(this.$route, [tag], 'any'))
		},
	},
}
</script>

<style lang="scss" scoped>
@use './navigationEntry.scss';
</style>
