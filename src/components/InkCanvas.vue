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
			<NcButton :disabled="!strokes.length || saving" @click="undo">
				{{ t('notes', 'Undo') }}
			</NcButton>
			<NcButton :disabled="saving" @click="$emit('close')">
				{{ t('notes', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="saving" @click="done">
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
			penSeenAt: 0,
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
		const existing = await loadInk(this.noteId, this.inkId)
		/* Strokes we cannot read are not a reason to refuse to open: the reader
		   gets an empty canvas rather than a dead end. */
		this.strokes = existing?.strokes ?? []
		this.draw()
	},

	beforeUnmount() {
		window.removeEventListener('resize', this.onResize)
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

		onDown(event) {
			if (event.pointerType === 'pen') {
				this.penSeenAt = Date.now()
			}
			if (!shouldDraw(event, this.penSeen())) {
				return
			}
			this.$refs.canvas?.setPointerCapture?.(event.pointerId)
			this.current = { points: samplesFrom(event) }
		},

		onMove(event) {
			if (!this.current) {
				return
			}
			if (event.pointerType === 'pen') {
				this.penSeenAt = Date.now()
			}
			this.current.points.push(...samplesFrom(event))
			this.draw()
		},

		onUp() {
			if (this.current) {
				this.strokes.push(this.current)
				this.current = null
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
