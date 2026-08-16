import { EmbedBuilder, MessageFlags } from "discord.js";
import type { MessageCreateOptions } from "discord.js";
import { SeriesSource } from "./db";

/**
 * Builds the "new chapter" message.
 *
 * Two things here are load-bearing and easy to break:
 *
 * 1. Mentions stay in `content`, never in the embed. Embeds render a mention as a
 *    link but do not notify anybody, and `content` is also what
 *    `allowedMentions: { parse: ["users"] }` in client.ts guards — series titles
 *    come from third-party markup, so a title containing "@here" would otherwise
 *    mass-ping on every release, forever.
 *
 * 2. Every string that reaches EmbedBuilder is clamped first. The builder validates
 *    eagerly and THROWS above its limits (verified against discord.js 14.27.0:
 *    setTitle accepts 256 characters and throws at 257). Titles are scraped, so an
 *    unclamped one would throw inside applyUpdate, get swallowed by the pass's
 *    catch, and freeze that series permanently — the exact failure class this
 *    codebase keeps having to fix. buildAnnouncement therefore cannot throw: it
 *    falls back to the plain-text message the bot sent before embeds existed.
 */

/** Matches the source badge colours in the web panel, so the two surfaces agree. */
const COLOR_BY_SOURCE: Record<SeriesSource, number> = {
  [SeriesSource.MangaDex]: 0xff6740,
  [SeriesSource.AsuraScans]: 0x8b5cf6,
  [SeriesSource.WeebCentral]: 0x14b8a6,
};

/** Discord's documented embed limits. */
const LIMITS = { title: 256, author: 256, footer: 2048 } as const;

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

/** Discord rejects a non-https URL outright, and a scraped link is not trustworthy. */
const safeUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

export interface AnnouncementInput {
  seriesName: string;
  seriesUrl: string;
  source: SeriesSource;
  chapter: string;
  chapterUrl: string;
  imageUrl: string | null;
  /** Already-rendered "<@id> <@id>" string; empty when nobody is subscribed. */
  mentions: string;
  /** Upstream publish time, when the source gave us one. */
  publishedAt: Date | null;
}

export const plainTextAnnouncement = (input: AnnouncementInput): string =>
  `New chapter of ${input.seriesName} is out! ${input.chapterUrl}\n${input.mentions}`.trim();

export const buildEmbed = (input: AnnouncementInput): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(COLOR_BY_SOURCE[input.source])
    .setTitle(clamp(`Chapter ${input.chapter}`, LIMITS.title))
    .setAuthor({ name: clamp(input.seriesName, LIMITS.author), url: safeUrl(input.seriesUrl) })
    .setFooter({ text: clamp(input.source, LIMITS.footer) });

  const chapterUrl = safeUrl(input.chapterUrl);
  if (chapterUrl) embed.setURL(chapterUrl);

  const thumbnail = safeUrl(input.imageUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);

  // The source's own publish time, not "now" — the bot may be announcing something
  // that came out hours ago.
  if (input.publishedAt && !Number.isNaN(input.publishedAt.getTime())) {
    embed.setTimestamp(input.publishedAt);
  }

  return embed;
};

/**
 * Everything the send needs.
 *
 * `SuppressNotifications` is the part worth understanding. 69 of 79 series have no
 * subscriber, so most announcements ping nobody and exist purely as a feed. Sending
 * those silently means the channel still receives every chapter while only the
 * series someone actually subscribed to light up a phone — turning a long-unused
 * subscription table into the notification filter it should always have been.
 */
export const buildAnnouncement = (input: AnnouncementInput): MessageCreateOptions => {
  const silent = input.mentions.trim().length === 0;

  try {
    return {
      content: input.mentions || undefined,
      embeds: [buildEmbed(input)],
      ...(silent ? { flags: MessageFlags.SuppressNotifications } : {}),
    };
  } catch (error) {
    // Never let a malformed embed cost us the chapter.
    console.error(`Could not build an embed for ${input.seriesName}; falling back to plain text:`, error);
    return {
      content: plainTextAnnouncement(input),
      ...(silent ? { flags: MessageFlags.SuppressNotifications } : {}),
    };
  }
};
