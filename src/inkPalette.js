/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * What ink can be written in.
 *
 * Ordered, because the picker shows them in this order and a stored value has
 * to mean the same color tomorrow. The keys are stable identifiers; the names
 * a reader sees are translated in the component, so this module stays free of
 * the translation globals and can be tested on its own.
 *
 * Every value was chosen against a measurement rather than by eye: each clears
 * 4.5:1 against the light theme's background and 7:1 against both dark ones,
 * after the dark-mode filter has flipped its lightness. `docs/INK-COLOR-DESIGN.md`
 * carries the table. A seventh color needs the same two numbers before it
 * belongs here.
 */
export const INK_COLORS = [
	{ key: 'ink', value: '#000000' },
	{ key: 'red', value: '#cc0000' },
	{ key: 'orange', value: '#b35900' },
	{ key: 'green', value: '#008800' },
	{ key: 'blue', value: '#0044cc' },
	{ key: 'purple', value: '#7733cc' },
]

/**
 * What a stroke is drawn in when it says nothing else.
 *
 * Black, so a file written before strokes carried a color reads exactly as it
 * did - and so the canvas a reader has never touched the picker on behaves the
 * way it always has.
 */
export const DEFAULT_INK_COLOR = INK_COLORS[0].value

/* Where the last choice is kept. Per browser, not per note: the pen is a tool,
   and a tool stays where it was left. */
const REMEMBERED = 'notes-ink-color'

/**
 * The palette's own version of a color, or the default.
 *
 * Everything arriving from outside this module goes through here: a stroke read
 * out of a file, and the value read back from storage. An ink file can be
 * copied in from anywhere and edited by anything, and what it says would
 * otherwise reach fillStyle directly - where an unrecognized string silently
 * draws nothing at all.
 *
 * @param {string | null | undefined} value what was found
 * @return {string} a color this palette offers
 */
export function knownColor(value) {
	const wanted = typeof value === 'string' ? value.toLowerCase() : ''
	return INK_COLORS.some((color) => color.value === wanted) ? wanted : DEFAULT_INK_COLOR
}

/**
 * The color to open the canvas in.
 *
 * @return {string} the last color chosen here, or the default
 */
export function rememberedColor() {
	try {
		return knownColor(window.localStorage.getItem(REMEMBERED))
	} catch {
		/* Storage can be unreadable - a private window, or site data blocked.
		   The canvas still opens; it just opens in black. */
		return DEFAULT_INK_COLOR
	}
}

/**
 * Keep this color for next time.
 *
 * @param {string} value the chosen color
 */
export function rememberColor(value) {
	try {
		window.localStorage.setItem(REMEMBERED, knownColor(value))
	} catch {
		/* Full, or unwritable. The choice still holds for as long as this
		   canvas is open, which is the part that matters now. */
	}
}
