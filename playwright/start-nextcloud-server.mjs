/*!
 * SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: MIT
 */

/* global process */

import {
	configureNextcloud,
	startNextcloud,
	stopNextcloud,
	waitOnNextcloud,
} from '@nextcloud/e2e-test-server/docker'
import { readFileSync } from 'fs'
import { execSync } from 'node:child_process'

async function start() {
	const appinfo = readFileSync('appinfo/info.xml').toString()
	const maxVersion = appinfo.match(/<nextcloud min-version="\d+" max-version="(\d\d+)" \/>/)?.[1]

	let branch = 'master'
	if (maxVersion) {
		const refs = execSync('git ls-remote --refs').toString('utf-8')
		branch = refs.includes(`refs/heads/stable${maxVersion}`)
			? `stable${maxVersion}`
			: branch
	}

	return await startNextcloud(branch, true, {
		exposePort: 8089,
	})
}

/**
 * Poll the Notes API until it answers. The web workers cache the app config and
 * the compiled routes in APCu for a few seconds, and `occ app:enable` runs in a
 * separate process that cannot invalidate them, so requests sent right after
 * enabling the app are answered with 404 until those caches expire.
 *
 * @param {string} ip Host and port the Nextcloud container is reachable at
 */
async function waitOnNotesApi(ip) {
	const user = process.env.NC_USER ?? 'admin'
	const password = process.env.NC_PASS ?? 'admin'
	const headers = { Authorization: `Basic ${btoa(`${user}:${password}`)}` }
	const deadline = Date.now() + 60_000

	process.stdout.write('\nWaiting for the Notes API… ⏳\n')
	while (true) {
		const status = await fetch(`http://${ip}/index.php/apps/notes/api/v1/settings`, { headers })
			.then((response) => response.status, () => 0)
		if (status === 200) {
			break
		}
		if (Date.now() > deadline) {
			throw new Error(`Notes API is not reachable, last status: ${status}`)
		}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	process.stdout.write('└─ Notes API is ready 🎉\n')
}

/**
 * Leave the container up when a local run ends.
 *
 * stopNextcloud() removes the container rather than stopping it, so every
 * graceful teardown threw away a working instance and the next run paid twenty
 * minutes to pull the image, install Nextcloud and reinstall Text and Files
 * Lock. startNextcloud() already reuses a running container, and replaces one
 * whose image has gone out of date, so keeping it is what makes Playwright's
 * reuseExistingServer worth having.
 *
 * CI still removes it: there nothing should outlive the job. Set
 * NOTES_E2E_REMOVE_CONTAINER=1 to ask for the same thing by hand.
 */
async function stop() {
	if (process.env.CI || process.env.NOTES_E2E_REMOVE_CONTAINER === '1') {
		process.stderr.write('Stopping Nextcloud server…\n')
		await stopNextcloud()
	} else {
		process.stderr.write('Leaving the Nextcloud container up for the next run…\n')
	}
	process.exit(0)
}

process.on('SIGTERM', stop)
process.on('SIGINT', stop)

// Start the Nextcloud docker container
const ip = await start()
await waitOnNextcloud(ip)
await configureNextcloud(['notes'])
await waitOnNotesApi(ip)

// Idle to wait for shutdown
while (true) {
	await new Promise((resolve) => setTimeout(resolve, 5000))
}
