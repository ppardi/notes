/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Page } from '@playwright/test'

/**
 * Faults in how the page is laid out, as opposed to what it says.
 *
 * Every one of these is a bug that reached a release and was reported from a
 * phone rather than caught here:
 *
 * - a control hung in a margin that is 22px wide on a phone and 28px wide in
 *   the stylesheet, so it sat off the side of the screen (6.99.12);
 * - a toolbar offset by a clickable area's width inside a pane exactly as wide,
 *   making the pane wider than itself and giving a thumb something to drag
 *   sideways (6.99.13);
 * - a pane sized to its parent's full height while sitting a button's height
 *   below its top, so its bottom - and the toolbar pinned to it - fell out of
 *   the window (6.99.14).
 *
 * None of the three is visible in a screenshot of a page at rest. Two are
 * invisible in any screenshot at all: what they change is what happens when
 * the page is touched.
 *
 * @param page the page under test
 * @return one line per fault, empty when the layout is sound
 */
export async function layoutProblems(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const w = window.innerWidth
		const h = window.innerHeight
		const problems: string[] = []
		const name = (el: HTMLElement) => {
			const classes = (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.')
			return `${el.tagName.toLowerCase()}.${classes}`
		}

		/* CodeMirror keeps a fixed gutter to hide the native scrollbars, the
		   same width at every viewport and on a desktop too, so it is not the
		   fault this looks for. Line wrapping is on, so nothing is out there to
		   scroll to either. */
		const allowedToPan = (el: HTMLElement) => el.closest('.CodeMirror') !== null

		/* A closed navigation drawer is parked off the side on purpose and
		   leaves a sliver on screen, so it is partly visible by design rather
		   than by accident. Everything inside it is parked with it. */
		const parkedOnPurpose = (el: HTMLElement) => el.closest('.app-navigation--closed') !== null

		/* Something to press, type in or follow. */
		const isControl = (el: HTMLElement) => el.matches('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="menuitem"]')

		document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
			const style = window.getComputedStyle(el)
			if (style.visibility === 'hidden' || style.display === 'none') {
				return
			}
			const box = el.getBoundingClientRect()
			/* Small boxes are skipped to keep the noise down - but not controls.
			   A control is small precisely when it is the kind of thing that
			   goes missing off an edge: the fold chevron is 28px square, and an
			   earlier version of this check stepped straight over it. */
			if (!isControl(el) && (box.width < 40 || box.height < 20)) {
				return
			}
			if (box.width < 2 || box.height < 2) {
				return
			}
			/* Parked entirely outside the window - a closed navigation drawer, a
			   skip link - is deliberate, and not the same thing as reaching past
			   an edge while on screen. */
			if (box.right <= 0 || box.left >= w || box.top >= h || box.bottom <= 0) {
				return
			}

			if (parkedOnPurpose(el)) {
				return
			}

			/* Reaching past an edge is only a fault for something a person has
			   to get at. A panel that bleeds under the window's own frame is
			   how the app is drawn; a button that does it cannot be pressed,
			   which is how the fold control shipped off the side of a phone and
			   how a whole toolbar ended up below the bottom of the window. */
			if (isControl(el)) {
				if (box.left < -0.5) {
					problems.push(`${name(el)} is ${Math.round(-box.left)}px past the leading edge`)
				}
				if (box.right > w + 0.5) {
					problems.push(`${name(el)} is ${Math.round(box.right - w)}px past the trailing edge`)
				}
				if (box.bottom > h + 0.5) {
					problems.push(`${name(el)} is ${Math.round(box.bottom - h)}px below the window`)
				}
				if (box.top < -0.5) {
					problems.push(`${name(el)} is ${Math.round(-box.top)}px above the window`)
				}
			}

			if (el.scrollWidth > el.clientWidth + 1
				&& style.overflowX !== 'visible'
				&& !allowedToPan(el)) {
				problems.push(`${name(el)} can be dragged ${el.scrollWidth - el.clientWidth}px sideways`)
			}

			const scrolls = ['auto', 'scroll'].includes(style.overflowY)
				|| ['auto', 'scroll'].includes(style.overflowX)
			if (scrolls && box.bottom > h + 0.5 && !allowedToPan(el)) {
				problems.push(`${name(el)} scrolls but ends ${Math.round(box.bottom - h)}px below the window`)
			}

			if (style.position === 'sticky' || style.position === 'fixed') {
				if (box.bottom > h + 0.5 || box.top < -0.5 || box.left < -0.5 || box.right > w + 0.5) {
					problems.push(`${name(el)} is pinned outside the window`)
				}
			}
		})
		return Array.from(new Set(problems))
	})
}
