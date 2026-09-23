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
			:name="tag.name"
			:active="selectedTags.includes(tag.name)"
			class="tag-entry"
			@click.prevent.stop="onSelect(tag.name)"
		>
			<template #icon>
				<PoundIcon :size="20" />
			</template>
			<template #counter>
				<NcCounterBubble :count="tag.count" />
			</template>
		</NcAppNavigationItem>
	</template>
</template>

<script>
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import PoundIcon from 'vue-material-design-icons/Pound.vue'
import store from '../store.js'
import { tagsRoute } from '../Util.js'

export default {
	name: 'TagsList',

	components: {
		NcAppNavigationCaption,
		NcAppNavigationItem,
		NcCounterBubble,
		PoundIcon,
	},

	props: {
		loading: Boolean,
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
