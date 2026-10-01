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
