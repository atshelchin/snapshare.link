import type { PackageLocales } from '@shelchin/i18n';
import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

export const PACKAGE_NAME = '__default__';
export const locales = {
	en,
	zh
} as PackageLocales;
