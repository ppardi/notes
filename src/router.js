/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { generateUrl } from '@nextcloud/router'
import { createRouter, createWebHistory } from 'vue-router'
import Loading from './components/Loading.vue'
import NotesView from './components/NotesView.vue'

export default createRouter({
	history: createWebHistory(generateUrl('apps/notes')),
	linkActiveClass: 'active',
	routes: [
		{
			path: '/',
			name: 'loading',
			component: Loading,
		},
		{
			path: '/welcome',
			name: 'welcome',
			/* The list, with nothing selected, rather than a page of its own:
			   having no note to show is no reason to take the list away. */
			components: {
				default: NotesView,
			},
		},
		{
			path: '/note/:noteId',
			name: 'note',
			components: {
				default: NotesView,
			},
			props: {
				default: true,
			},
		},
	],
})
