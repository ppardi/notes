<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<ul v-if="matches.length > 0"
		:id="listId"
		ref="list"
		:style="style"
		class="tag-completion"
		role="listbox"
		:aria-label="t('notes', 'Tags')"
	>
		<li v-for="(tag, index) in matches"
			:id="`${listId}-${index}`"
			:key="tag"
			:class="{ 'tag-completion__item--active': index === active }"
			:aria-selected="index === active"
			class="tag-completion__item"
			role="option"
			@mousedown.prevent="choose(tag)"
		>
			#{{ tag }}
		</li>
	</ul>
</template>

<script>
import store from '../store.js'

/* Anything that could still grow into a tag: a hash, then the letters typed so
   far. The hash has to start a word, the way the server's parser requires, or
   every URL fragment would offer completions. */
const PARTIAL_TAG = /(?:^|[\s([{"'])#([\p{L}\p{N}][\p{L}\p{N}_-]*)?$/u

/* Enough to choose from without covering the text being written. */
const MAX_MATCHES = 5

/* Clear of the window's edges, and of the line the caret is on. */
const EDGE_MARGIN = 8
const CARET_GAP = 4

let nextListId = 0

export default {
	name: 'TagCompletion',

	props: {
		/**
		 * The element holding the editor, whose typing this completes.
		 */
		editorElement: {
			type: Object,
			default: null,
		},
	},

	emits: ['select'],

	data() {
		return {
			listId: `tag-completion-${nextListId++}`,
			matches: [],
			active: 0,
			partial: '',
			style: {},
			/* The word a completion was refused for, so that the keystroke
			   after Escape does not open the list again. */
			dismissed: null,
			attached: null,
		}
	},

	watch: {
		editorElement: {
			immediate: true,
			handler() {
				this.$nextTick(this.attach)
			},
		},
	},

	mounted() {
		window.addEventListener('resize', this.reposition)
		/* Captured, because the editor scrolls inside its own box rather than
		   the window: a list pinned to the caret has to follow it. */
		window.addEventListener('scroll', this.reposition, true)
	},

	unmounted() {
		window.removeEventListener('resize', this.reposition)
		window.removeEventListener('scroll', this.reposition, true)
		this.detach()
	},

	methods: {
		attach() {
			this.detach()
			const element = this.editorElement
			if (!element) {
				return
			}
			this.attached = element
			// captured, so that the list sees Enter before the editor does
			element.addEventListener('keydown', this.onKeyDown, true)
			element.addEventListener('keyup', this.update)
			element.addEventListener('click', this.update)
			element.addEventListener('blur', this.clear, true)
		},

		detach() {
			const element = this.attached
			if (!element) {
				return
			}
			element.removeEventListener('keydown', this.onKeyDown, true)
			element.removeEventListener('keyup', this.update)
			element.removeEventListener('click', this.update)
			element.removeEventListener('blur', this.clear, true)
			this.attached = null
			this.clear()
		},

		clear() {
			this.matches = []
			this.active = 0
			this.partial = ''
		},

		/**
		 * The tag being typed, when the caret is sitting in one.
		 *
		 * @return {string|null} the letters after the hash, or null when the
		 *                       caret is not in a tag at all
		 */
		partialAtCaret() {
			const selection = window.getSelection()
			if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
				return null
			}
			const node = selection.anchorNode
			if (!node || !this.attached?.contains(node)) {
				return null
			}
			const before = (node.textContent ?? '').slice(0, selection.anchorOffset)
			const match = PARTIAL_TAG.exec(before)
			return match === null ? null : (match[1] ?? '')
		},

		update() {
			const partial = this.partialAtCaret()
			if (partial === null) {
				this.dismissed = null
				this.clear()
				return
			}
			/* Dismissed stays dismissed until the word changes, or the keyup
			   that follows Escape would open the list straight back up. */
			if (partial === this.dismissed) {
				this.clear()
				return
			}
			this.dismissed = null

			const typed = partial.toLowerCase()
			const matches = store.notes.getTags()
				.map((tag) => tag.name)
				.filter((name) => name.startsWith(typed) && name !== typed)
				.slice(0, MAX_MATCHES)
			if (matches.length === 0) {
				this.clear()
				return
			}
			/* The list is rebuilt on every keystroke, including the arrow keys
			   that walk it, so the choice only goes back to the top when the
			   list itself has changed. */
			const changed = matches.length !== this.matches.length
				|| matches.some((name, index) => name !== this.matches[index])
			this.partial = partial
			this.matches = matches
			if (changed) {
				this.active = 0
			}
			this.reposition()
		},

		/**
		 * Put the list at the caret, and keep it on the screen.
		 *
		 * Both are needed: a list pinned to the caret alone runs off the window
		 * whenever the caret is near an edge, which is exactly where a long line
		 * leaves it.
		 */
		reposition() {
			if (this.matches.length === 0) {
				return
			}
			const selection = window.getSelection()
			if (!selection || selection.rangeCount === 0) {
				return
			}
			const caret = selection.getRangeAt(0).getBoundingClientRect()
			/* Measured after the list has been laid out, since where it fits
			   depends on how big it is. */
			this.$nextTick(() => {
				const list = this.$refs.list
				if (!list) {
					return
				}
				const width = list.offsetWidth
				const height = list.offsetHeight
				const room = {
					right: window.innerWidth - EDGE_MARGIN,
					bottom: window.innerHeight - EDGE_MARGIN,
				}

				// towards the left when there is no room to the right
				let left = caret.left
				if (left + width > room.right) {
					left = room.right - width
				}
				left = Math.max(EDGE_MARGIN, left)

				// above the line when there is no room below it
				let top = caret.bottom + CARET_GAP
				if (top + height > room.bottom) {
					const above = caret.top - CARET_GAP - height
					top = above >= EDGE_MARGIN ? above : Math.max(EDGE_MARGIN, room.bottom - height)
				}

				this.style = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` }
			})
		},

		onKeyDown(event) {
			if (this.matches.length === 0) {
				return
			}
			if (event.key === 'Escape') {
				this.dismissed = this.partial
				this.clear()
			} else if (event.key === 'ArrowDown') {
				this.active = (this.active + 1) % this.matches.length
			} else if (event.key === 'ArrowUp') {
				this.active = (this.active - 1 + this.matches.length) % this.matches.length
			} else if (event.key === 'Enter' || event.key === 'Tab') {
				this.choose(this.matches[this.active])
			} else {
				return
			}
			/* The editor must not also act on the key that drove the list, or
			   choosing a tag would break the line as well. */
			event.preventDefault()
			event.stopPropagation()
		},

		choose(tag) {
			const partial = this.partial
			/* Offering the same word again the moment it is complete would put
			   the list back up over what was just written. */
			this.dismissed = tag
			this.clear()
			this.$emit('select', { tag, partial })
		},
	},
}
</script>

<style lang="scss" scoped>
.tag-completion {
	position: fixed;
	z-index: 2000;
	margin: 0;
	padding: calc(var(--default-grid-baseline) / 2);
	list-style: none;
	min-width: 12em;
	max-width: min(24em, 90vw);
	background-color: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);
	box-shadow: 0 1px 5px var(--color-box-shadow);
}

.tag-completion__item {
	padding: var(--default-grid-baseline) calc(var(--default-grid-baseline) * 2);
	border-radius: var(--border-radius);
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	&--active,
	&:hover {
		background-color: var(--color-background-hover);
	}
}
</style>
