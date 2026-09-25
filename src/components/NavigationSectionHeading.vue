<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<li class="app-navigation-caption" :class="{ 'app-navigation-caption--collapsed': collapsed }">
		<!--
			The heading is the control, and the actions sit beside it rather than
			inside it - the shape NcAppNavigationItem already uses for its own
			rows. A role on the row itself would instead make one control that
			contains another, whose name is read out of everything inside it,
			and would take this item out of its list.
		-->
		<button type="button"
			class="app-navigation-caption__toggle"
			:aria-expanded="!collapsed"
			@click="$emit('toggle')"
		>
			<!-- Says what the button already says, so it is not read out. -->
			<span class="app-navigation-caption__chevron" aria-hidden="true" />
			<span class="app-navigation-caption__name">{{ name }}</span>
		</button>

		<div v-if="$slots.actions" class="app-navigation-caption__actions">
			<NcActions :inline="0" :ariaLabel="actionsAriaLabel">
				<template v-if="$slots.actionsTriggerIcon" #icon>
					<slot name="actionsTriggerIcon" />
				</template>
				<slot name="actions" />
			</NcActions>
		</div>
	</li>
</template>

<script>
import NcActions from '@nextcloud/vue/components/NcActions'

export default {
	name: 'NavigationSectionHeading',

	components: {
		NcActions,
	},

	props: {
		/**
		 * The section's name, which is also the button's label.
		 */
		name: {
			type: String,
			required: true,
		},

		/**
		 * Whether the section it heads is closed.
		 */
		collapsed: Boolean,

		/**
		 * What the actions menu is called, for people who cannot see its icon.
		 */
		actionsAriaLabel: {
			type: String,
			default: '',
		},
	},

	emits: ['toggle'],
}
</script>

<style lang="scss" scoped>
/* NcAppNavigationCaption's own styles are scoped to its component, so they
   cannot be inherited by this markup and are restated here. Kept to the same
   class names, so the two read as the same thing in the DOM. */
.app-navigation-caption {
	display: flex;
	justify-content: space-between;

	&:not(:first-child) {
		margin-top: calc(var(--default-clickable-area) / 2);
	}
}

/* Fills the row, so the whole heading answers a click - everything except the
   actions menu, which is its own control. */
.app-navigation-caption__toggle {
	display: flex;
	align-items: center;
	flex: 1 1 auto;
	min-width: 0;
	gap: calc(var(--default-grid-baseline) * 2);
	border: none;
	background: none;
	padding: 0;
	margin: 0;
	font: inherit;
	text-align: start;
	cursor: pointer;
	border-radius: var(--border-radius-element, var(--border-radius-large));

	&:focus-visible {
		outline: 2px solid var(--color-main-text);
		outline-offset: -2px;
	}
}

.app-navigation-caption__name {
	font-weight: var(--font-weight-heading, bold);
	color: var(--color-main-text);
	font-size: var(--default-font-size);
	line-height: var(--default-clickable-area);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	box-shadow: none !important;
	padding-block: 0;
	padding-inline: 0;
	margin-top: 0;
	margin-bottom: var(--default-grid-baseline);
}

/* A triangle that turns, drawn rather than imported: it is decoration for a
   state the button already announces. */
.app-navigation-caption__chevron {
	flex: 0 0 auto;
	width: 0;
	height: 0;
	margin-inline-start: calc(var(--default-grid-baseline) * 2);
	border-block: 4px solid transparent;
	border-inline-start: 6px solid currentColor;
	color: var(--color-main-text);
	transform: rotate(90deg);
	transition: transform 100ms ease-in-out;
}

.app-navigation-caption--collapsed .app-navigation-caption__chevron {
	transform: none;
}

.app-navigation-caption__actions {
	flex: 0 0 var(--default-clickable-area);
}
</style>
