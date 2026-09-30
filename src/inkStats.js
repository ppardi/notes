/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Whether the ink canvas should show its readout.
 *
 * Asked for with ?inkstats=1 and turned off again with ?inkstats=0. The answer
 * is taken here, as this module loads, rather than when the canvas opens: the
 * note router drops query parameters it does not know on its first navigation,
 * so by the time someone has opened a note and tapped Ink the URL no longer
 * says anything. Kept for the tab, because that is how long the question is
 * worth remembering.
 */

const KEY = 'notes:inkstats'

/**
 * @param {string} name the item to read
 * @return {string | null} its value, or null where storage is refused
 */
function stored(name) {
	try {
		return window.sessionStorage?.getItem(name) ?? null
	} catch {
		/* Private browsing can refuse storage outright. */
		return null
	}
}

/* Read loosely as well as properly. A note in a category already carries a
   query, so appending "?inkstats=1" to its URL puts the question inside the
   category's value instead of alongside it - a second question mark does not
   start a second query. That is a reasonable thing to type and an
   unreasonable thing to ignore, so the whole URL is searched when the
   parameter is not there as one. Needs a value, so a note that merely
   mentions the word does not switch it on. */
const LOOSE = /[?&.]inkstats(?:=([^&#?]*))?/

const asked = (() => {
	try {
		const proper = new URLSearchParams(window.location.search).get('inkstats')
		if (proper !== null) {
			return proper
		}
		const loose = LOOSE.exec(window.location.href ?? '')
		return loose ? (loose[1] ?? '') : null
	} catch {
		return null
	}
})()

const off = asked === '0' || asked === 'off'

try {
	if (off) {
		window.sessionStorage?.removeItem(KEY)
	} else if (asked !== null) {
		window.sessionStorage?.setItem(KEY, '1')
	}
} catch {
	/* Nothing to remember it in; the URL still answers for this page. */
}

/**
 * @return {boolean} whether the readout was asked for
 */
export function statsWanted() {
	if (off) {
		return false
	}
	return asked !== null || stored(KEY) === '1'
}
