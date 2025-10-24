import { deLocalizeUrl } from '@shelchin/i18n/utils';
export const reroute = (request: { url: URL }) => {
	return deLocalizeUrl(request.url).pathname;
};
