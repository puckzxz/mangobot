import { describe, expect, test } from "bun:test";
import { chapterNumberFromLabel, parseFeed, weebcentralRssUrl } from "./weebcentral";

const feed = (channel: string, items: string[]) =>
  `<rss><channel>${channel}${items.map((i) => `<item>${i}</item>`).join("")}</channel></rss>`;

const chapter = (title: string, link: string, pubDate: string) =>
  `<title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${pubDate}</pubDate>`;

describe("weebcentralRssUrl", () => {
  test.each([
    ["https://weebcentral.com/series/01ABC", "https://weebcentral.com/series/01ABC/rss"],
    ["https://weebcentral.com/series/01ABC/One-Punch-Man", "https://weebcentral.com/series/01ABC/rss"],
  ])("%s -> %s", (input, expected) => {
    expect(weebcentralRssUrl(input as string)).toBe(expected as string);
  });

  test.each([["https://weebcentral.com/"], ["not a url"], ["https://weebcentral.com/search?q=x"]])(
    "%s yields null rather than throwing",
    (input) => {
      expect(weebcentralRssUrl(input as string)).toBeNull();
    }
  );
});

describe("chapterNumberFromLabel", () => {
  /**
   * Labels are not uniform across series. Reading a fixed token position is what
   * silently froze One-Punch Man on the literal string "Version".
   */
  test.each([
    ["Chapter 51", "51"],
    ["No. 107", "107"],
    ["Episode 267", "267"],
    ["Mag Version 236", "236"],
    ["One-Punch Man Mag Version 237", "237"],
    ["The Eminence in Shadow Episode. 82", "82"],
    ["Chapter 98.5", "98.5"],
    ["Chapter 51 ", "51"],
  ])("%s -> %s", (label, expected) => {
    expect(chapterNumberFromLabel(label as string)).toBe(expected as string);
  });

  test("a label with no trailing number is undefined, not a wrong guess", () => {
    expect(chapterNumberFromLabel("Season 3 Finale")).toBeUndefined();
    expect(chapterNumberFromLabel("[Season 3] Ep. 235 (Finale)")).toBeUndefined();
  });
});

describe("parseFeed", () => {
  test("picks the newest item by publication date, not by feed order", () => {
    const xml = feed("<title>A Series</title><url>https://cdn/cover.jpg</url>", [
      chapter("A Series Chapter 10", "https://x/10", "Mon, 01 Jun 2026 00:00:00 +0000"),
      chapter("A Series Chapter 12", "https://x/12", "Wed, 03 Jun 2026 00:00:00 +0000"),
      chapter("A Series Chapter 11", "https://x/11", "Tue, 02 Jun 2026 00:00:00 +0000"),
    ]);

    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.result.latestChapter).toBe("12");
    expect(parsed.ok && parsed.result.chapterUrl).toBe("https://x/12");
    expect(parsed.ok && parsed.result.title).toBe("A Series");
    expect(parsed.ok && parsed.result.imageUrl).toBe("https://cdn/cover.jpg");
  });

  test("carries the upstream publish date through", () => {
    const xml = feed("<title>A Series</title>", [
      chapter("A Series Chapter 1", "https://x/1", "Wed, 03 Jun 2026 12:00:00 +0000"),
    ]);

    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok && parsed.result.publishedAt?.toISOString()).toBe("2026-06-03T12:00:00.000Z");
  });

  /**
   * Observed live on The Eminence in Shadow: Ep.83 dated 26 Jul, Ep.82 dated
   * 31 Jul. Newest-by-date therefore reports a LOWER number than the one already
   * stored. This pins the behaviour so the eventual fix is a deliberate change.
   */
  test("a back-dated republish makes the newest item an older chapter number", () => {
    const xml = feed("<title>The Eminence in Shadow</title>", [
      chapter("The Eminence in Shadow Episode. 83", "https://x/83", "Sun, 26 Jul 2026 17:09:33 +0000"),
      chapter("The Eminence in Shadow Episode. 82", "https://x/82", "Fri, 31 Jul 2026 12:40:35 +0000"),
    ]);

    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok && parsed.result.latestChapter).toBe("82");
  });

  test("the channel title is never mistaken for a chapter title", () => {
    const xml = feed("<title>Channel Name 999</title>", [
      chapter("Real Chapter 7", "https://x/7", "Mon, 01 Jun 2026 00:00:00 +0000"),
    ]);

    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok && parsed.result.title).toBe("Channel Name 999");
    expect(parsed.ok && parsed.result.latestChapter).toBe("7");
  });

  test("a feed with no items is empty, which is different from a broken feed", () => {
    const parsed = parseFeed(feed("<title>A Series</title>", []), "https://weebcentral.com/series/01ABC");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toBe("empty");
  });

  test("a feed with no channel title is a parse failure", () => {
    const xml = feed("", [chapter("Chapter 1", "https://x/1", "Mon, 01 Jun 2026 00:00:00 +0000")]);
    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toBe("parse");
  });

  test("an unparseable chapter label is a parse failure, not a silent skip", () => {
    const xml = feed("<title>A Series</title>", [
      chapter("Season 3 Finale", "https://x/f", "Mon, 01 Jun 2026 00:00:00 +0000"),
    ]);
    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toBe("parse");
  });

  /** Non-ASCII titles used to be mangled, which made those series unsubscribable. */
  test("decodes entities in the channel title", () => {
    const xml = feed("<title>&#332;oku &amp; Co.</title>", [
      chapter("Chapter 3", "https://x/3", "Mon, 01 Jun 2026 00:00:00 +0000"),
    ]);
    const parsed = parseFeed(xml, "https://weebcentral.com/series/01ABC");
    expect(parsed.ok && parsed.result.title).toBe("Ōoku & Co.");
  });
});
