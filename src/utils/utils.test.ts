import { describe, expect, test } from "bun:test";
import { tryToDetermineSeriesSource, SUPPORTED_HOSTNAMES } from "./try-to-determine-series-source";
import extractMangadexId from "./extract-mangadex-id";
import { decodeEntities } from "./html-entities";
import { formatCatalogLine, parseCatalogLine } from "../catalog-line";
import { SeriesSource } from "../db";
import { emojiNumbers } from "../emoji";

describe("tryToDetermineSeriesSource", () => {
  test.each([
    ["https://weebcentral.com/series/01ABC", SeriesSource.WeebCentral],
    ["https://www.weebcentral.com/series/01ABC", SeriesSource.WeebCentral],
    ["https://asurascans.com/comics/nano-machine", SeriesSource.AsuraScans],
    ["https://mangadex.org/title/abc", SeriesSource.MangaDex],
  ])("%s -> %s", (url, expected) => {
    expect(tryToDetermineSeriesSource(url as string)).toBe(expected as SeriesSource);
  });

  /** A prefix match accepted `https://asura.attacker.tld`, which would then be persisted and refetched forever. */
  test.each([
    ["https://asura.attacker.tld/comics/x"],
    ["https://asurascans.com.evil.tld/comics/x"],
    ["http://asurascans.com/comics/x"], // http, not https
    ["not a url"],
    ["https://example.com/series/1"],
  ])("%s is rejected", (url) => {
    expect(tryToDetermineSeriesSource(url as string)).toBeNull();
  });

  test("hostname matching is case-insensitive", () => {
    expect(tryToDetermineSeriesSource("https://WeebCentral.COM/series/01ABC")).toBe(SeriesSource.WeebCentral);
  });

  test("the advertised hostname list is derived, so it cannot drift from what is accepted", () => {
    for (const hostname of SUPPORTED_HOSTNAMES) {
      expect(tryToDetermineSeriesSource(`https://${hostname}/x`)).not.toBeNull();
    }
  });
});

describe("extractMangadexId", () => {
  const uuid = "3f1453eb-0ff1-4b6e-8dcb-4b8a4e8b1c0f";

  test("pulls the uuid out of a title URL", () => {
    expect(extractMangadexId(`https://mangadex.org/title/${uuid}/some-slug`)).toBe(uuid);
    expect(extractMangadexId(`https://mangadex.org/title/${uuid}?x=1`)).toBe(uuid);
  });

  /** `url.split("/title/")[1]` was undefined here, and `.includes` on it threw a TypeError. */
  test.each([
    ["https://mangadex.org"],
    ["https://mangadex.org/chapter/abc"],
    [`https://mangadex.org/title/not-a-uuid`],
    [`https://weebcentral.com/title/${"3f1453eb-0ff1-4b6e-8dcb-4b8a4e8b1c0f"}`],
  ])("%s returns null rather than throwing", (url) => {
    expect(extractMangadexId(url as string)).toBeNull();
  });
});

describe("decodeEntities", () => {
  test.each([
    ["&quot;x&quot;", '"x"'],
    ["&apos;x&apos;", "'x'"],
    ["&#39;x&#39;", "'x'"],
    ["&lt;b&gt;", "<b>"],
    ["&#332;oku", "Ōoku"],
    ["&#x14C;oku", "Ōoku"],
    ["Tom &amp; Jerry", "Tom & Jerry"],
  ])("%s -> %s", (input, expected) => {
    expect(decodeEntities(input as string)).toBe(expected as string);
  });

  /** &amp; is decoded last so an escaped entity is not decoded twice. */
  test("does not double-decode", () => {
    expect(decodeEntities("&amp;quot;")).toBe("&quot;");
  });
});

describe("catalog line round-trip", () => {
  const entry = (name: string) => ({ name, source: "WeebCentral", url: "https://weebcentral.com/series/01ABC" });

  test.each([
    ["One-Punch Man"],
    ["Ōoku"], // stripping non-ASCII mangled this to "oku", making it unsubscribable
    ["'Tis Time for Torture, Princess"],
    ["Fate/Type Redline"],
    ["MAD (OTORI Yusuke)"],
  ])("%s survives format -> parse", (name) => {
    const line = formatCatalogLine(emojiNumbers[0]!, entry(name as string));
    expect(parseCatalogLine(emojiNumbers[0]!, line)).toBe(name as string);
  });

  /** 🔟 is above U+FFFF, so a naive slice(2) ate its surrogate pair. */
  test("works for the tenth entry, whose emoji is outside the BMP", () => {
    const tenth = emojiNumbers[9]!;
    const line = formatCatalogLine(tenth, entry("Tenth Series"));
    expect(parseCatalogLine(tenth, line)).toBe("Tenth Series");
  });

  /** lastIndexOf, because a title is free to contain the separator itself. */
  test("a title containing the separator round-trips", () => {
    const name = "Before -> After";
    const line = formatCatalogLine(emojiNumbers[0]!, entry(name));
    expect(parseCatalogLine(emojiNumbers[0]!, line)).toBe(name);
  });

  test("a line reacted with the wrong emoji does not resolve", () => {
    const line = formatCatalogLine(emojiNumbers[0]!, entry("One-Punch Man"));
    expect(parseCatalogLine(emojiNumbers[1]!, line)).toBeNull();
  });

  test("a line that is not a catalog entry does not resolve", () => {
    expect(parseCatalogLine(emojiNumbers[0]!, `${emojiNumbers[0]} just some text`)).toBeNull();
  });
});
