<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2018 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Notes\Service;

use OCA\Notes\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IConfig;
use OCP\IL10N;

class SettingsService {
	/** Caps on the stored smart categories, which are user-editable stored JSON. */
	private const SMART_CATEGORIES = 64;
	private const SMART_CATEGORY_NAME_LENGTH = 128;
	private const SMART_CATEGORY_TAGS = 32;
	private const SMART_CATEGORY_ID_LENGTH = 32;
	private const SMART_CATEGORY_PARENT_LENGTH = 512;

	private IConfig $config;
	private IL10N $l10n;
	private IRootFolder $root;
	private IAppManager $appManager;
	private HashtagParser $hashtagParser;

	/* Allowed attributes */
	private array $attrs;

	private $defaultSuffixes = [ '.md', '.txt' ];

	public function __construct(
		IConfig $config,
		IL10N $l10n,
		IRootFolder $root,
		IAppManager $appManager,
		HashtagParser $hashtagParser,
	) {
		$this->config = $config;
		$this->l10n = $l10n;
		$this->root = $root;
		$this->appManager = $appManager;
		$this->hashtagParser = $hashtagParser;
		$this->attrs = [
			'fileSuffix' => $this->getListAttrs('fileSuffix', [...$this->defaultSuffixes, 'custom']),
			'notesPath' => [
				'default' => function (string $uid) {
					return $this->getDefaultNotesNode($uid)['path'];
				},
				'validate' => function ($value) {
					$value = str_replace([ '/', '\\' ], DIRECTORY_SEPARATOR, $value);
					$parts = explode(DIRECTORY_SEPARATOR, $value);
					$path = [];
					foreach ($parts as $part) {
						if ($part === '..') {
							array_pop($path);
						} elseif (strlen($part) && $part !== '.') {
							array_push($path, $part);
						}
					}
					return implode(DIRECTORY_SEPARATOR, $path);
				},
			],
			'noteMode' => $this->getListAttrs('noteMode', $this->getAvailableEditorModes()),
			'customSuffix' => [
				'default' => $this->defaultSuffixes[0],
				'validate' => function ($value) {
					$out = ltrim(preg_replace('/[^A-Za-z0-9.-]/', '', $value), '.');
					if (empty($out)) {
						$out = substr($this->defaultSuffixes[0], 1);
					}
					return '.' . $out;
				},
			],
			'showHidden' => [
				'default' => false,
				'validate' => function (mixed $value) : bool {
					return (bool)$value;
				}
			],
			'loadRecentOnStartUp' => [
				'default' => true,
				'validate' => function (mixed $value) : bool {
					return $value === 'true' || $value === true;
				},
			],
			// The categories whose children are collapsed in the navigation.
			// Only the collapsed ones are stored: categories are open by
			// default, so one nobody has closed needs no entry.
			'collapsedCategories' => [
				'default' => [],
				'validate' => function (mixed $value) : array {
					if (!is_array($value)) {
						return [];
					}
					$names = [];
					foreach ($value as $name) {
						if (is_string($name) && $name !== '') {
							$names[] = mb_substr($name, 0, 4096);
						}
						if (count($names) >= 1000) {
							break;
						}
					}
					return array_values(array_unique($names));
				},
			],
			// Categories whose contents are a tag query rather than a folder.
			// Settings are stored JSON and come back as untrusted input, so
			// every field is capped and coerced on the way in rather than being
			// trusted at the point of use.
			'smartCategories' => [
				'default' => [],
				'validate' => function (mixed $value) : array {
					if (!is_array($value)) {
						return [];
					}
					$categories = [];
					$seen = [];
					foreach ($value as $entry) {
						/* A record saved earlier arrives as an object, since the
						   blob is decoded without assoc, while one that has just
						   come in on a request arrives as an array. */
						if ($entry instanceof \stdClass) {
							$entry = (array)$entry;
						}
						if (!is_array($entry)) {
							continue;
						}
						/* Identity is the id, so a record without one cannot be
						   selected, renamed or deleted — there is nothing useful
						   to keep. preg_replace answers null on failure, which
						   mb_substr has refused to be handed since PHP 8.1. */
						$cleaned = is_string($entry['id'] ?? null)
							? preg_replace('/[^A-Za-z0-9_-]/', '', $entry['id'])
							: null;
						$id = is_string($cleaned)
							? mb_substr($cleaned, 0, self::SMART_CATEGORY_ID_LENGTH)
							: '';
						if ($id === '' || isset($seen[$id])) {
							continue;
						}
						$name = is_string($entry['name'] ?? null)
							? mb_substr(trim($entry['name']), 0, self::SMART_CATEGORY_NAME_LENGTH)
							: '';
						if ($name === '') {
							continue;
						}
						$tags = [];
						$stored = $entry['tags'] ?? null;
						foreach (is_array($stored) ? $stored : [] as $tag) {
							if (!is_string($tag)) {
								continue;
							}
							/* The same reading a tag gets when it is parsed out
							   of a note, so a stored query cannot name something
							   no note could ever carry. */
							$parsed = $this->hashtagParser->parseExactTag($tag);
							if ($parsed !== null && !in_array($parsed, $tags, true)) {
								$tags[] = $parsed;
							}
							if (count($tags) >= self::SMART_CATEGORY_TAGS) {
								break;
							}
						}
						if ($tags === []) {
							continue;
						}
						$seen[$id] = true;
						$categories[] = [
							'id' => $id,
							'name' => $name,
							'tags' => $tags,
							/* Exactly 'all' or nothing: the filter then has only
							   the two branches it is written for, however the
							   setting was edited. */
							'mode' => ($entry['mode'] ?? null) === 'all' ? 'all' : 'any',
							'parent' => $this->normalizeCategoryPath($entry['parent'] ?? null),
						];
						if (count($categories) >= self::SMART_CATEGORIES) {
							break;
						}
					}
					return $categories;
				},
			],
			// The category selected when the app was last used, so that opening
			// the app from the app menu returns to it. 'all' means all notes; a
			// 'category:' prefix carries the category, which may be empty for the
			// uncategorized one.
			'lastViewedCategory' => [
				'default' => 'all',
				'validate' => function (mixed $value) : string {
					if (!is_string($value)) {
						return 'all';
					}
					if ($value !== 'all' && !str_starts_with($value, 'category:')) {
						return 'all';
					}
					return mb_substr($value, 0, 4096);
				},
			],
		];
	}

	/**
	 * A category path with its segments trimmed and its empty ones dropped.
	 *
	 * The parent is only ever compared against paths built from note folders,
	 * so a stray slash or a padded segment would put a smart category under a
	 * parent that can never match, and it would silently go missing.
	 */
	private function normalizeCategoryPath(mixed $value) : string {
		if (!is_string($value)) {
			return '';
		}
		$segments = [];
		foreach (explode('/', $value) as $segment) {
			$segment = trim($segment);
			if ($segment !== '') {
				$segments[] = $segment;
			}
		}
		return mb_substr(implode('/', $segments), 0, self::SMART_CATEGORY_PARENT_LENGTH);
	}

	private function getListAttrs(string $attributeName, array $values) : array {
		$default = $this->config->getAppValue(Application::APP_ID, $attributeName, $values[0]);

		return [
			'default' => $default,
			'validate' => function ($value) use ($values, $default) {
				if (in_array($value, $values)) {
					return $value;
				} else {
					return $default;
				}
			},
		];
	}

	/**
	 * Return the default notes node if it exists and the expected path if it exists
	 * @return array{
	 *     path: string,
	 *     folder: ?Folder
	 * }
	 */
	public function getDefaultNotesNode(string $uid): array {
		$defaultFolder = $this->config->getAppValue(Application::APP_ID, 'defaultFolder', 'Notes') ?: 'Notes';
		$userFolder = $this->root->getUserFolder($uid);
		try {
			/** @var Folder $node */
			$node = $userFolder->get($defaultFolder);
			return [
				'path' => $defaultFolder,
				'folder' => $node,
			];
		} catch (NotFoundException) {
			$path = $this->l10n->t($defaultFolder);

			if ($path == $defaultFolder) {
				// English locale, still non-existing
				return [
					'path' => $path,
					'folder' => null,
				];
			}

			try {
				/** @var Folder $node */
				$node = $userFolder->get($path);
				return [
					'path' => $path,
					'folder' => $node,
				];
			} catch (NotFoundException) {
				return [
					'path' => $path,
					'folder' => null,
				];
			}
		}
	}

	/**
	 * @throws \OCP\PreConditionNotMetException
	 */
	public function set(string $uid, array $settings, bool $writeDefaults = false) : void {
		// load existing values for missing attributes
		$oldSettings = $this->getSettingsFromDB($uid);
		foreach ($oldSettings as $name => $value) {
			if (!array_key_exists($name, $settings)) {
				$settings[$name] = $value;
			}
		}
		// remove illegal, empty and default settings
		foreach ($settings as $name => $value) {
			/* Anything that is not one of ours is dropped before it is asked
			   for a default it does not have. The request's own parameters
			   arrive in this array — "_route" among them — and once one was
			   stored it came back on every later write. */
			if (!array_key_exists($name, $this->attrs)) {
				unset($settings[$name]);
				continue;
			}
			if ($value !== null) {
				$settings[$name] = $value = $this->attrs[$name]['validate']($value);
			}
			if ($name === 'notesPath' && $value !== null) {
				continue;
			}
			$default = is_callable($this->attrs[$name]['default']) ? $this->attrs[$name]['default']($uid) : $this->attrs[$name]['default'];
			if (!$writeDefaults && ($value === null || $value === $default)) {
				unset($settings[$name]);
			}
		}
		$this->config->setUserValue($uid, Application::APP_ID, 'settings', json_encode($settings));
	}

	/**
	 * @throws \OCP\PreConditionNotMetException
	 */
	public function setPublic(string $uid, array $settings) : void {
		if (array_key_exists('fileSuffix', $settings)
			&& $settings['fileSuffix'] !== null
			&& !in_array($settings['fileSuffix'], $this->defaultSuffixes)
		) {
			$settings['customSuffix'] = $settings['fileSuffix'];
			$settings['fileSuffix'] = 'custom';
		}
		$this->set($uid, $settings);
	}

	private function getSettingsFromDB(string $uid) : \stdClass {
		$settings = json_decode($this->config->getUserValue($uid, Application::APP_ID, 'settings'));
		if (!is_object($settings)) {
			$settings = new \stdClass();
		}
		return $settings;
	}

	public function getAll(string $uid, $saveInitial = false) : \stdClass {
		$settings = $this->getSettingsFromDB($uid);
		// use default for empty settings
		$toBeSaved = false;
		foreach ($this->attrs as $name => $attr) {
			if (!property_exists($settings, $name)) {
				$defaultValue = $attr['default'];
				if (is_callable($defaultValue)) {
					$settings->{$name} = $defaultValue($uid);
					$toBeSaved = $saveInitial;
				} else {
					$settings->{$name} = $defaultValue;
				}
			}
		}
		if ($toBeSaved) {
			$this->set($uid, (array)$settings);
		}
		return $settings;
	}

	/**
	 * @throws \OCP\PreConditionNotMetException
	 */
	public function getValueString(string $uid, string $name, bool $saveInitial = false) : string {
		return $this->get($uid, $name, 'string', $saveInitial);
	}

	/**
	 * @throws \OCP\PreConditionNotMetException
	 */
	public function getValueBool(string $uid, string $name, bool $saveInitial = false) : bool {
		return $this->get($uid, $name, 'boolean', $saveInitial);
	}

	public function delete(string $uid, string $name): void {
		$this->config->deleteUserValue($uid, Application::APP_ID, $name);
	}

	public function getPublic(string $uid) : \stdClass {
		// initialize and load settings
		$settings = $this->getAll($uid, true);
		// translate internal settings to public settings
		if ($settings->fileSuffix === 'custom') {
			$settings->fileSuffix = $settings->customSuffix;
		}
		unset($settings->customSuffix);
		return $settings;
	}

	private function getAvailableEditorModes(): array {
		return \OCP\Util::getVersion()[0] >= 26 && $this->appManager->isEnabledForUser('text')
			? ['rich', 'edit', 'preview']
			: ['edit', 'preview'];
	}

	/**
	 * @throws \OCP\PreConditionNotMetException
	 */
	private function get(string $uid, string $name, string $type, bool $saveInitial = false) : mixed {
		$settings = $this->getAll($uid, $saveInitial);
		if (property_exists($settings, $name)) {
			$value = $settings->{$name};
			if (gettype($value) !== $type) {
				throw new \TypeError('Invalid type');
			}

			return $value;
		} else {
			throw new \OCP\PreConditionNotMetException('Setting ' . $name . ' not found for user ' . $uid . '.');
		}
	}

}
