/**
 * The catalog message is written by `update-catalog.ts` and read back by the
 * reaction handler in `index.ts`. Both live here so the two halves cannot drift.
 *
 * The reader used to reverse-engineer the line by stripping every codepoint in
 * U+0080..U+FFFF and then slicing two characters. That worked for entries 1-9 and
 * broke for the 10th on every page: 🔟 is above U+FFFF, so it survived the strip
 * and `.slice(2)` ate its surrogate pair instead, leaving a leading space. It also
 * mangled any non-ASCII title — "Ōoku" came back as "oku" — so those series could
 * never be subscribed to either.
 */

export interface CatalogEntry {
  name: string;
  source: string;
  url: string;
}

export const formatCatalogLine = (emoji: string, entry: CatalogEntry): string =>
  `${emoji} ${entry.name} -> [${entry.source}](<${entry.url}>)`;

/**
 * Recovers the series name from a rendered line. The emoji is passed in rather
 * than inferred, since the caller already knows which one was reacted with.
 */
export const parseCatalogLine = (emoji: string, line: string): string | null => {
  if (!line.startsWith(emoji)) {
    return null;
  }

  const rest = line.slice(emoji.length).trim();
  // lastIndexOf: a series title is free to contain " -> " itself.
  const separator = rest.lastIndexOf(" -> ");

  if (separator === -1) {
    return null;
  }

  const name = rest.slice(0, separator).trim();
  return name || null;
};
