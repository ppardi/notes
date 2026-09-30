/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [vue()],
	test: {
		include: ['src/tests/**/*.spec.js'],
		// jsdom rather than node: escapeHtml() builds an element, and the app
		// logger other modules pull in reads window at import time. The Vue plugin
		// compiles the single-file components that the component specs mount.
		environment: 'jsdom',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcovonly'],
			include: ['src/**/*.js'],
		},
	},
})
