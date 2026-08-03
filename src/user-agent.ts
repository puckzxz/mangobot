/**
 * Sent on every outbound HTTP request.
 *
 * WeebCentral sits behind Cloudflare and returns 403 to a request with no
 * User-Agent at all, and the MangaDex API asks clients to identify themselves.
 * Both accept an honest identifying string, so there is no reason to impersonate
 * a browser here.
 */
export const USER_AGENT = "mangobot/1.0 (Discord chapter-update bot)";
