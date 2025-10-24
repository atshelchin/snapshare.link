import type { LayoutServerLoad } from './$types.js';
import { extractLocaleFromPathname, extractLocaleFromCookie } from '@shelchin/i18n/utils';
const supportedLocales = ['en', 'ja', 'zh', 'fr'];
export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const locale =
		extractLocaleFromPathname(url.pathname) || extractLocaleFromCookie(cookies) || 'en';

	return {
		locale: supportedLocales.includes(locale) ? locale : 'en'
	};
};
