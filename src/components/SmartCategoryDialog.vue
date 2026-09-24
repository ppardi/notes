<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcDialog :open="open"
		:name="isNew ? t('notes', 'New smart category') : t('notes', 'Edit smart category')"
		size="normal"
		@update:open="$emit('update:open', $event)"
	>
		<div class="smart-dialog">
			<!-- v-model, not :value.sync: the installed NcTextField emits
			     update:modelValue and nothing else, so a .sync binding would
			     leave the field looking editable while the name never changed
			     and every category quietly took its tags as its name. -->
			<NcTextField v-model="name"
				:label="t('notes', 'Name')"
				:placeholder="suggestedName"
			/>

			<fieldset class="smart-dialog__tags">
				<legend>{{ t('notes', 'Tags') }}</legend>
				<p v-if="available.length === 0" class="smart-dialog__empty">
					{{ t('notes', 'No tags yet. Write #something in a note to make one.') }}
				</p>
				<NcCheckboxRadioSwitch v-for="tag in available"
					:key="tag.name"
					:modelValue="chosen.includes(tag.name)"
					@update:modelValue="toggle(tag.name, $event)"
				>
					{{ tag.name }}
				</NcCheckboxRadioSwitch>
			</fieldset>

			<fieldset v-if="chosen.length > 1" class="smart-dialog__mode">
				<legend>{{ t('notes', 'Which notes') }}</legend>
				<NcCheckboxRadioSwitch :modelValue="mode"
					value="any"
					name="smart-category-mode"
					type="radio"
					@update:modelValue="mode = $event"
				>
					{{ t('notes', 'Any of these tags') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch :modelValue="mode"
					value="all"
					name="smart-category-mode"
					type="radio"
					@update:modelValue="mode = $event"
				>
					{{ t('notes', 'All of these tags') }}
				</NcCheckboxRadioSwitch>
			</fieldset>

			<!-- What it will hold, before it is made: a category that turns out
			     empty is worth knowing about now rather than after saving. -->
			<p class="smart-dialog__count">
				{{ n('notes', '%n note', '%n notes', count) }}
			</p>
		</div>

		<template #actions>
			<NcButton variant="tertiary" @click="$emit('update:open', false)">
				{{ t('notes', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="chosen.length === 0" @click="onSave">
				{{ isNew ? t('notes', 'Create') : t('notes', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { makeSmartCategoryId } from '../smartCategories.js'
import store from '../store.js'

export default {
	name: 'SmartCategoryDialog',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
		NcDialog,
		NcTextField,
	},

	props: {
		open: Boolean,

		/** The record being edited, or null when one is being made. */
		smartCategory: {
			type: Object,
			default: null,
		},

		/** Where a new one is to be filed. */
		parent: {
			type: String,
			default: '',
		},
	},

	emits: ['update:open', 'save'],

	data() {
		return {
			name: '',
			chosen: [],
			mode: 'any',
		}
	},

	computed: {
		isNew() {
			return this.smartCategory === null
		},

		/* The tags in use, plus any the record already names. A tag whose last
		   note has been deleted or retagged is still part of what this category
		   means, and dropping it from the list would quietly drop it from the
		   category on the next save. */
		available() {
			const inUse = store.notes.getTags()
			const known = new Set(inUse.map((tag) => tag.name))
			const missing = this.chosen
				.filter((tag) => !known.has(tag))
				.map((tag) => ({ name: tag, count: 0 }))
			return [...inUse, ...missing].sort((a, b) => a.name.localeCompare(b.name))
		},

		count() {
			return store.notes.countNotesWithTags(this.chosen, this.mode)
		},

		suggestedName() {
			return this.chosen.map((tag) => `#${tag}`).join(' ')
		},
	},

	watch: {
		open: {
			immediate: true,
			handler(open) {
				if (!open) {
					return
				}
				/* Opened fresh every time, or the last edit leaks into the next
				   one. */
				this.name = this.smartCategory?.name ?? ''
				this.chosen = [...(this.smartCategory?.tags ?? [])]
				this.mode = this.smartCategory?.mode === 'all' ? 'all' : 'any'
			},
		},
	},

	methods: {
		toggle(tag, checked) {
			this.chosen = checked
				? [...this.chosen, tag]
				: this.chosen.filter((name) => name !== tag)
		},

		onSave() {
			if (this.chosen.length === 0) {
				return
			}
			/* An unnamed category takes its tags as its name, so that what is in
			   the navigation always says what it is looking for. */
			const name = this.name.trim() || this.suggestedName
			this.$emit('save', {
				id: this.smartCategory?.id ?? makeSmartCategoryId(),
				name,
				tags: [...this.chosen],
				mode: this.chosen.length > 1 ? this.mode : 'any',
				parent: this.smartCategory?.parent ?? this.parent,
			})
			this.$emit('update:open', false)
		},
	},
}
</script>

<style lang="scss" scoped>
.smart-dialog {
	display: flex;
	flex-direction: column;
	gap: calc(var(--default-grid-baseline) * 3);
	padding: calc(var(--default-grid-baseline) * 2);
}

.smart-dialog__tags {
	/* The list is as long as the person's tags, which has no bound. */
	max-height: 40vh;
	overflow-y: auto;
}

.smart-dialog__count {
	color: var(--color-text-maxcontrast);
}
</style>
