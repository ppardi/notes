/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* global process */

import { execSync } from 'node:child_process'
import { basename } from 'node:path'

/** The port the main checkout publishes on, which the dev scripts and docs name. */
const MAIN_PORT = 8089
/** Worktrees take a port from this block, one each. */
const FIRST_WORKTREE_PORT = 8100
const WORKTREE_PORTS = 100

/**
 * Whether this checkout is a linked worktree rather than the main one.
 *
 * @return {boolean} true in a worktree created by `git worktree add`
 */
function inLinkedWorktree() {
	try {
		const quiet = { stdio: ['ignore', 'pipe', 'ignore'] }
		const gitDir = execSync('git rev-parse --absolute-git-dir', quiet).toString().trim()
		const common = execSync('git rev-parse --path-format=absolute --git-common-dir', quiet).toString().trim()
		return gitDir !== common
	} catch {
		// Not a git checkout at all, so not a worktree either.
		return false
	}
}

/**
 * The host port this checkout's Nextcloud container is published on.
 *
 * The server library names its container after the directory it was started
 * from, so every checkout already gets a container of its own - but the port
 * was 8089 for all of them, so a worktree could only run while every other
 * checkout stood idle, and two runs would fight over the binding. The main
 * checkout keeps 8089; a worktree derives one from its directory name, so it
 * keeps the same port between runs and two worktrees can run at once.
 *
 * NOTES_E2E_PORT overrides both.
 *
 * @return {number} the host port
 */
export function e2ePort() {
	if (process.env.NOTES_E2E_PORT) {
		return Number(process.env.NOTES_E2E_PORT)
	}
	if (!inLinkedWorktree()) {
		return MAIN_PORT
	}

	const name = basename(process.cwd())
	let hash = 0
	for (const character of name) {
		hash = (hash * 31 + character.charCodeAt(0)) % 100000
	}
	return FIRST_WORKTREE_PORT + (hash % WORKTREE_PORTS)
}

/**
 * Where this checkout's Nextcloud answers.
 *
 * @return {string} the base URL, without a trailing slash
 */
export function e2eBaseUrl() {
	return `http://localhost:${e2ePort()}`
}
