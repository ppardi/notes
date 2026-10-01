/**
 * SPDX-FileCopyrightText: 2026 ppardi <6176270+ppardi@users.noreply.github.com>
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Read back what a device actually saved, so ink drawn on the iPad can be
 * looked at from here.
 *
 *   node dev/inspect-ink.mjs            every ink block in the dev container
 *   node dev/inspect-ink.mjs <noteId>   just that note's
 */
const BASE = process.env.NOTES_DEV_URL ?? 'http://localhost:8089'
const AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64')

const notes = await (await fetch(`${BASE}/index.php/apps/notes/api/v1/notes`, {
	headers: { Authorization: AUTH, 'OCS-APIRequest': 'true' },
})).json()

const wanted = process.argv[2] ? notes.filter((n) => String(n.id) === process.argv[2]) : notes

/** @param {Uint8Array} png the file @return {object} what it carries */
function read(png) {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	const out = { pixels: [view.getUint32(16), view.getUint32(20)], strokes: null, origin: undefined }
	let at = 8
	while (at + 8 <= png.length) {
		const length = view.getUint32(at)
		const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7])
		if (type === 'tEXt') {
			const payload = png.subarray(at + 8, at + 8 + length)
			const nul = payload.indexOf(0)
			const keyword = Buffer.from(payload.subarray(0, nul)).toString('latin1')
			if (keyword === 'notes-ink') {
				const base64 = Buffer.from(payload.subarray(nul + 1)).toString('latin1')
				const carried = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
				out.strokes = carried.strokes
				out.origin = carried.origin
			}
		}
		if (type === 'IEND') { break }
		at += 12 + length
	}
	return out
}

for (const note of wanted) {
	for (const [, path] of (note.content ?? '').matchAll(/\((\.attachments\.\d+\/ink-[\w-]+\.png)\)/g)) {
		const file = `Notes/${note.category ? note.category + '/' : ''}${path}`
		const response = await fetch(`${BASE}/remote.php/dav/files/admin/${file.split('/').map(encodeURIComponent).join('/')}`, {
			headers: { Authorization: AUTH },
		})
		if (!response.ok) {
			console.log(`${path}: could not read (${response.status}) at ${file}`)
			continue
		}
		const png = new Uint8Array(await response.arrayBuffer())
		const { pixels, strokes, origin } = read(png)
		console.log(`\nnote ${note.id} "${note.title}" — ${path}`)
		console.log(`  file: ${(png.length / 1024).toFixed(1)} KB, ${pixels[0]}x${pixels[1]} pixels`)
		if (!strokes) {
			console.log('  no strokes in it')
			continue
		}
		const xs = strokes.flatMap((s) => s.points.map((p) => p[0]))
		const ys = strokes.flatMap((s) => s.points.map((p) => p[1]))
		const width = Math.max(...xs) - Math.min(...xs)
		const height = Math.max(...ys) - Math.min(...ys)
		const samples = strokes.reduce((n, s) => n + s.points.length, 0)
		console.log(`  ${strokes.length} strokes, ${samples} samples`)
		console.log(`  drawn ${width.toFixed(0)}x${height.toFixed(0)} CSS px`)
		console.log(`  => ${(pixels[0] / (width || 1)).toFixed(2)} image pixels per CSS pixel`)
		console.log(`  origin: ${origin === undefined ? 'ABSENT — saved by a build before positions were kept' : JSON.stringify(origin)}`)
		const pressures = new Set(strokes.flatMap((s) => s.points.map((p) => p[2])))
		console.log(`  pointer: ${pressures.size === 1 ? `one flat pressure (${[...pressures][0]}) — a mouse` : `${pressures.size} pressures — a stylus`}`)

		/* The Pencil reports each position twice. A sample in the same place as
		   the one before it carries nothing and makes the stroke a staircase
		   for the smoothing to follow, which is what put facets in curves.
		   Any at all means the build that saved this was not dropping them. */
		const gaps = []
		for (const stroke of strokes) {
			for (let i = 1; i < stroke.points.length; i++) {
				gaps.push(Math.hypot(
					stroke.points[i][0] - stroke.points[i - 1][0],
					stroke.points[i][1] - stroke.points[i - 1][1],
				))
			}
		}
		const repeats = gaps.filter((g) => g === 0).length
		gaps.sort((a, b) => a - b)
		const at = (p) => (gaps[Math.floor(gaps.length * p)] ?? 0).toFixed(1)
		console.log(`  gap between samples: median ${at(0.5)} px, p90 ${at(0.9)} px, max ${(gaps.at(-1) ?? 0).toFixed(1)} px`)
		console.log(`  repeated positions: ${repeats}/${gaps.length}${repeats ? '  <<< saved by a build that kept them' : '  — none, so repeats are being dropped'}`)
	}
}
