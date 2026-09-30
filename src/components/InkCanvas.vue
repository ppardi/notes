<!--
  - SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="ink" role="dialog" :aria-label="t('notes', 'Ink')">
		<canvas
			ref="canvas"
			class="ink__canvas"
			@pointerdown="onDown"
			@pointermove="onMove"
			@pointerup="onUp"
			@pointercancel="onUp"
		/>
		<div class="ink__bar">
			<NcButton :disabled="!ready || !strokes.length || saving" @click="undo">
				{{ t('notes', 'Undo') }}
			</NcButton>
			<NcButton @click="$emit('close')">
				{{ t('notes', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="!ready || saving" @click="done">
				{{ t('notes', 'Done') }}
			</NcButton>
		</div>
		<p v-if="error" class="ink__error" role="alert">
			{{ error }}
		</p>
	</div>
</template>

<script>
import { getStroke } from 'perfect-freehand'
import NcButton from '@nextcloud/vue/components/NcButton'
import { loadInk, saveInk } from '../inkFile.js'
import { PEN_SEEN_MS, samplesFrom, shouldDraw } from '../inkInput.js'

export default {
	name: 'InkCanvas',

	components: {
		NcButton,
	},

	props: {
		noteId: {
			type: Number,
			required: true,
		},

		inkId: {
			type: String,
			required: true,
		},
	},

	emits: ['saved', 'close'],

	data() {
		return {
			strokes: [],
			current: null,
			pointerId: null,
			pointerType: null,
			penSeenAt: 0,
			ready: false,
			saving: false,
			error: '',
		}
	},

	async mounted() {
		this.fit()
		/* Rotating an iPad changes the canvas size. Without this the backing
		   store keeps the old dimensions and every stroke drawn afterwards
		   lands offset from the pen - on the one device this is built for. */
		window.addEventListener('resize', this.onResize)
		/* The window is not the only thing that resizes the canvas: showing the
		   error message changes the layout beneath it. Watch the element itself. */
		if (typeof ResizeObserver !== 'undefined') {
			this.observer = new ResizeObserver(() => this.onResize())
			this.observer.observe(this.$refs.canvas)
		}
		try {
			const existing = await loadInk(this.noteId, this.inkId)
			/* Strokes we cannot read are not a reason to refuse to open: the
			   reader gets an empty canvas rather than a dead end. */
			this.strokes = existing?.strokes ?? []
			this.ready = true
			this.draw()
		} catch {
			/* We could not tell whether there is ink here already. Saving now
			   would replace it by name with whatever is drawn on a blank page,
			   so stay open to say so, but take no input and save nothing. */
			this.error = t('notes', 'The existing ink could not be loaded. Close this and try again; nothing has been changed.')
		}
	},

	beforeUnmount() {
		window.removeEventListener('resize', this.onResize)
		this.observer?.disconnect()
	},

	methods: {
		onResize() {
			this.fit()
			this.draw()
		},

		fit() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return
			}
			const ratio = window.devicePixelRatio || 1
			canvas.width = canvas.clientWidth * ratio
			canvas.height = canvas.clientHeight * ratio
			canvas.getContext('2d')?.scale(ratio, ratio)
		},

		penSeen() {
			return Date.now() - this.penSeenAt < PEN_SEEN_MS
		},

		/* Remember the pen on ANY pen event, hovering included: a Pencil near the
		   screen reports pointermove before it touches, and that is the signal
		   that a hand is about to land. */
		notePen(event) {
			if (event.pointerType === 'pen') {
				this.penSeenAt = Date.now()
			}
		},

		/* Whether input may change the drawing at all: not before the existing
		   ink has loaded (it would be replaced), and not while saving (a stroke
		   added now is in one of the PNG and the strokes but not the other). */
		accepting() {
			return this.ready && !this.saving
		},

		onDown(event) {
			this.notePen(event)
			if (!this.accepting()) {
				return
			}
			if (this.current) {
				/* One stroke at a time, except that the pen wins. Most iPads do
				   not report hover, so a resting palm can start a stroke before
				   any pen has been seen. When the pen then lands, that stroke was
				   the palm: drop it, uncommitted, and let the pen write. */
				if (event.pointerType !== 'pen' || this.pointerType === 'pen') {
					return
				}
				this.abandonStroke()
			}
			if (!shouldDraw(event, this.penSeen())) {
				return
			}
			this.$refs.canvas?.setPointerCapture?.(event.pointerId)
			this.pointerId = event.pointerId
			this.pointerType = event.pointerType
			this.current = { points: samplesFrom(event) }
		},

		onMove(event) {
			this.notePen(event)
			/* Only the pointer that started the stroke extends it. A palm resting
			   beside the pen keeps reporting moves, and those are not ink. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			this.current.points.push(...samplesFrom(event))
			this.draw()
		},

		onUp(event) {
			this.notePen(event)
			/* The palm lifting must not end the pen's stroke. */
			if (!this.current || event.pointerId !== this.pointerId || !this.accepting()) {
				return
			}
			this.finishStroke()
		},

		abandonStroke() {
			this.current = null
			this.pointerId = null
			this.pointerType = null
			this.draw()
		},

		finishStroke() {
			if (this.current) {
				this.strokes.push(this.current)
				this.current = null
				this.pointerId = null
				this.pointerType = null
				this.draw()
			}
		},

		undo() {
			this.strokes.pop()
			this.draw()
		},

		draw() {
			const context = this.$refs.canvas?.getContext('2d')
			if (!context) {
				return
			}
			/* Cleared in CSS pixels, because the context is scaled by the device
			   pixel ratio and its coordinates are CSS pixels from then on. */
			context.clearRect(0, 0, this.$refs.canvas.clientWidth, this.$refs.canvas.clientHeight)
			for (const stroke of [...this.strokes, this.current].filter(Boolean)) {
				const outline = getStroke(stroke.points, { size: 6, thinning: 0.6, simulatePressure: false })
				context.beginPath()
				outline.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)))
				context.closePath()
				context.fill()
			}
		},

		async done() {
			if (!this.ready || this.saving) {
				return
			}
			/* A stroke still under the pen is drawn on the canvas, so it would be
			   in the PNG but not in the strokes. Commit it first. */
			this.finishStroke()
			this.error = ''
			this.saving = true
			try {
				const png = await new Promise((resolve) => this.$refs.canvas.toBlob(resolve, 'image/png'))
				await saveInk(this.noteId, this.inkId, png, this.strokes)
				this.$emit('saved', { id: this.inkId })
				this.$emit('close')
			} catch {
				/* Stay open, holding the strokes. Closing here would lose a page
				   of handwriting to a moment's bad network. */
				this.error = t('notes', 'The ink could not be saved. It is still here — try again.')
			} finally {
				this.saving = false
			}
		},
	},
}
</script>

<style scoped>
.ink {
	position: fixed;
	inset: 0;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	background: var(--color-main-background);
}

.ink__canvas {
	flex: 1;
	/* A canvas is sized by its bitmap, which is larger than its box on a
	   high-density screen. Without this it can never shrink to make room for
	   the message below it. */
	min-height: 0;
	width: 100%;
	/* The canvas owns the surface while it is open, so a drag never reaches the
	   note behind it and "scroll" versus "draw" never has to be decided. */
	touch-action: none;
}

.ink__bar {
	display: flex;
	gap: var(--default-grid-baseline);
	justify-content: flex-end;
	padding: var(--default-grid-baseline);
	border-top: 1px solid var(--color-border);
}

.ink__error {
	padding: var(--default-grid-baseline);
	color: var(--color-error);
	text-align: center;
}
</style>
