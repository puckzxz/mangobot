import { describe, expect, test } from "bun:test";
import { tryToDetermineSeriesSource, SUPPORTED_HOSTNAMES } from "./try-to-determine-series-source";
import extractMangadexId from "./extract-mangadex-id";
import { decodeEntities } from "./html-entities";
import { SeriesSource } from "../db";

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
