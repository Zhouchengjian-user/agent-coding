/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../common/path.js';
import { promises } from 'fs';
import { mark } from '../common/performance.js';
import { ILanguagePacks, INLSConfiguration } from '../../nls.js';
import { Promises } from './pfs.js';

export interface IResolveNLSConfigurationContext {

	/**
	 * Location where `nls.messages.json` and `nls.keys.json` are stored.
	 */
	readonly nlsMetadataPath: string;

	/**
	 * Precomputed identity of the commit and NLS tables, supplied by packaged products.
	 */
	readonly nlsMetadataHash?: string;

	/**
	 * Optional built-in language pack used before the installed-language cache
	 * has been created. This allows a product to open in its default language on
	 * the first launch and while fully offline.
	 */
	readonly builtInLanguagePackPath?: string;

	/**
	 * Path to the user data directory. Used as a cache for
	 * language packs converted to the format we need.
	 */
	readonly userDataPath: string;

	/**
	 * Commit of the running application. Can be `undefined`
	 * when not built.
	 */
	readonly commit: string | undefined;

	/**
	 * Locale as defined in `argv.json` or `app.getLocale()`.
	 */
	readonly userLocale: string;

	/**
	 * Locale as defined by the OS (e.g. `app.getPreferredSystemLanguages()`).
	 */
	readonly osLocale: string;
}

export async function resolveNLSConfiguration({ userLocale, osLocale, userDataPath, commit, nlsMetadataPath, nlsMetadataHash, builtInLanguagePackPath }: IResolveNLSConfigurationContext): Promise<INLSConfiguration> {
	mark('code/willGenerateNls');
	// Development builds normally skip language-pack resolution because the
	// generated NLS metadata lives in `out-build`, not `out`. Agent coding ships
	// a built-in Chinese pack, so use that metadata during local development as
	// well. This keeps the development app consistent with the packaged product.
	const effectiveNlsMetadataPath = process.env['VSCODE_DEV'] && builtInLanguagePackPath
		? join(nlsMetadataPath, '..', 'out-build')
		: nlsMetadataPath;

	if (
		(process.env['VSCODE_DEV'] && !builtInLanguagePackPath) ||
		userLocale === 'pseudo' ||
		userLocale.startsWith('en') ||
		(!commit && !builtInLanguagePackPath) ||
		!userDataPath
	) {
		return defaultNLSConfiguration(userLocale, osLocale, effectiveNlsMetadataPath);
	}

	try {
		const languagePacks = await getLanguagePackConfigurations(userDataPath) ?? {};
		const builtInLanguagePacks = await getBuiltInLanguagePackConfigurations(builtInLanguagePackPath);
		for (const [language, languagePack] of Object.entries(builtInLanguagePacks ?? {})) {
			languagePacks[language] ??= languagePack;
		}
		if (Object.keys(languagePacks).length === 0) {
			return defaultNLSConfiguration(userLocale, osLocale, nlsMetadataPath);
		}

		const resolvedLanguage = resolveLanguagePackLanguage(languagePacks, userLocale);
		if (!resolvedLanguage) {
			return defaultNLSConfiguration(userLocale, osLocale, nlsMetadataPath);
		}

		const languagePack = languagePacks[resolvedLanguage];
		const mainLanguagePackPath = languagePack?.translations?.['vscode'];
		if (
			!languagePack ||
			typeof languagePack.hash !== 'string' ||
			!languagePack.translations ||
			typeof mainLanguagePackPath !== 'string' ||
			!(await Promises.exists(mainLanguagePackPath))
		) {
			return defaultNLSConfiguration(userLocale, osLocale, nlsMetadataPath);
		}

		const languagePackId = `${languagePack.hash}.${resolvedLanguage}`;
		const globalLanguagePackCachePath = join(userDataPath, 'clp', languagePackId);
		const commitLanguagePackCachePath = join(globalLanguagePackCachePath, nlsMetadataHash ?? commit ?? 'development');
		const languagePackMessagesFile = join(commitLanguagePackCachePath, 'nls.messages.json');
		const translationsConfigFile = join(globalLanguagePackCachePath, 'tcf.json');
		const languagePackCorruptMarkerFile = join(globalLanguagePackCachePath, 'corrupted.info');

		if (await Promises.exists(languagePackCorruptMarkerFile)) {
			await promises.rm(globalLanguagePackCachePath, { recursive: true, force: true, maxRetries: 3 }); // delete corrupted cache folder
		}

		const result: INLSConfiguration = {
			userLocale,
			osLocale,
			resolvedLanguage,
			defaultMessagesFile: join(effectiveNlsMetadataPath, 'nls.messages.json'),
			languagePack: {
				translationsConfigFile,
				messagesFile: languagePackMessagesFile,
				corruptMarkerFile: languagePackCorruptMarkerFile
			},

			// NLS: below properties are a relic from old times only used by vscode-nls and deprecated
			locale: userLocale,
			availableLanguages: { '*': resolvedLanguage },
			_languagePackId: languagePackId,
			_languagePackSupport: true,
			_translationsConfigFile: translationsConfigFile,
			_cacheRoot: globalLanguagePackCachePath,
			_resolvedLanguagePackCoreLocation: commitLanguagePackCachePath,
			_corruptedFile: languagePackCorruptMarkerFile
		};

		if (await Promises.exists(languagePackMessagesFile)) {
			touch(commitLanguagePackCachePath).catch(() => { }); // We don't wait for this. No big harm if we can't touch
			mark('code/didGenerateNls');
			return result;
		}

		const [
			nlsDefaultKeys,
			nlsDefaultMessages,
			nlsPackdata
		]:
			[Array<[string, string[]]>, string[], { contents: Record<string, Record<string, string>> }]
			//      ^moduleId ^nlsKeys                               ^moduleId      ^nlsKey ^nlsValue
			= await Promise.all([
				promises.readFile(join(effectiveNlsMetadataPath, 'nls.keys.json'), 'utf-8').then(content => JSON.parse(content)),
				promises.readFile(join(effectiveNlsMetadataPath, 'nls.messages.json'), 'utf-8').then(content => JSON.parse(content)),
				promises.readFile(mainLanguagePackPath, 'utf-8').then(content => JSON.parse(content)),
			]);

		const nlsResult: string[] = [];

		// We expect NLS messages to be in a flat array in sorted order as they
		// where produced during build time. We use `nls.keys.json` to know the
		// right order and then lookup the related message from the translation.
		// If a translation does not exist, we fallback to the default message.

		let nlsIndex = 0;
		for (const [moduleId, nlsKeys] of nlsDefaultKeys) {
			const moduleTranslations = nlsPackdata.contents[moduleId];
			for (const nlsKey of nlsKeys) {
				nlsResult.push(moduleTranslations?.[nlsKey] || nlsDefaultMessages[nlsIndex]);
				nlsIndex++;
			}
		}

		await promises.mkdir(commitLanguagePackCachePath, { recursive: true });

		await Promise.all([
			promises.writeFile(languagePackMessagesFile, JSON.stringify(nlsResult), 'utf-8'),
			promises.writeFile(translationsConfigFile, JSON.stringify(languagePack.translations), 'utf-8')
		]);

		mark('code/didGenerateNls');

		return result;
	} catch (error) {
		console.error('Generating translation files failed.', error);
	}

	return defaultNLSConfiguration(userLocale, osLocale, effectiveNlsMetadataPath);
}

/**
 * The `languagepacks.json` file is a JSON file that contains all metadata
 * about installed language extensions per language. Specifically, for
 * core (`vscode`) and all extensions it supports, it points to the related
 * translation files.
 *
 * The file is updated whenever a new language pack is installed or removed.
 */
async function getLanguagePackConfigurations(userDataPath: string): Promise<ILanguagePacks | undefined> {
	const configFile = join(userDataPath, 'languagepacks.json');
	try {
		return JSON.parse(await promises.readFile(configFile, 'utf-8'));
	} catch (err) {
		return undefined; // Do nothing. If we can't read the file we have no language pack config.
	}
}

interface IBuiltInLanguagePackManifest {
	readonly name: string;
	readonly publisher: string;
	readonly version: string;
	readonly contributes?: {
		readonly localizations?: readonly {
			readonly languageId: string;
			readonly languageName?: string;
			readonly localizedLanguageName?: string;
			readonly translations: readonly { readonly id: string; readonly path: string }[];
		}[];
	};
}

async function getBuiltInLanguagePackConfigurations(languagePackPath: string | undefined): Promise<ILanguagePacks | undefined> {
	if (!languagePackPath) {
		return undefined;
	}

	try {
		const manifest: IBuiltInLanguagePackManifest = JSON.parse(await promises.readFile(join(languagePackPath, 'package.json'), 'utf-8'));
		const languagePacks: ILanguagePacks = {};
		for (const localization of manifest.contributes?.localizations ?? []) {
			languagePacks[localization.languageId] = {
				hash: `builtin-${manifest.version}`,
				label: localization.localizedLanguageName ?? localization.languageName,
				extensions: [{
					extensionIdentifier: { id: `${manifest.publisher}.${manifest.name}` },
					version: manifest.version
				}],
				translations: Object.fromEntries(localization.translations.map(translation => [translation.id, join(languagePackPath, translation.path)]))
			};
		}
		return languagePacks;
	} catch {
		return undefined;
	}
}

function resolveLanguagePackLanguage(languagePacks: ILanguagePacks, locale: string | undefined): string | undefined {
	try {
		while (locale) {
			if (languagePacks[locale]) {
				return locale;
			}

			const index = locale.lastIndexOf('-');
			if (index > 0) {
				locale = locale.substring(0, index);
			} else {
				return undefined;
			}
		}
	} catch (error) {
		console.error('Resolving language pack configuration failed.', error);
	}

	return undefined;
}

function defaultNLSConfiguration(userLocale: string, osLocale: string, nlsMetadataPath: string): INLSConfiguration {
	mark('code/didGenerateNls');

	return {
		userLocale,
		osLocale,
		resolvedLanguage: 'en',
		defaultMessagesFile: join(nlsMetadataPath, 'nls.messages.json'),

		// NLS: below 2 are a relic from old times only used by vscode-nls and deprecated
		locale: userLocale,
		availableLanguages: {}
	};
}

//#region fs helpers

function touch(path: string): Promise<void> {
	const date = new Date();

	return promises.utimes(path, date, date);
}

//#endregion
