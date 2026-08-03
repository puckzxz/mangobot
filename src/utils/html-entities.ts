/**
 * Minimal entity decoder for the handful of entities that appear in the feeds and
 * markup we read. Needed in two places: lol-html (Bun's HTMLRewriter) hands back
 * attribute values as raw source text, and RSS titles arrive escaped.
 */
export const decodeEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0*(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Last, so a literally-escaped "&amp;quot;" is not decoded twice.
    .replace(/&amp;/g, "&");
