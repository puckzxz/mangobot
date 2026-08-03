# mangobot

A Discord bot that watches manga series for new chapters and posts them to a channel,
pinging whoever subscribed.

## How it works

A `node-schedule` job runs every 30 minutes, fetches the latest chapter for every
series in the database, and announces anything newer than what is stored. Members
subscribe by reacting to a numbered catalog message.

Every source is a plain HTTP call — there is no browser:

| Source      | How it is read                                                      |
| ----------- | ------------------------------------------------------------------- |
| WeebCentral | the per-series RSS feed at `/series/<id>/rss`                       |
| AsuraScans  | the server-rendered chapter list in the page's Astro island `props` |
| MangaDex    | the public JSON API                                                 |

Adding a source means adding an entry to `SCRAPERS` in `src/fetch-manga.ts`. That
table is `satisfies Record<SeriesSource, Scraper>`, so a new value in the Prisma enum
will not compile until it is routed.

Both scraped sources sit behind Cloudflare and enforce a burst quota, so requests are
paced (see `REQUEST_GAP_MS` in each scraper) and WeebCentral retries on 429.

## Running it

Requires **Bun** (the runtime) and **Node** (the Prisma CLI). `pnpm` is pinned via the
`packageManager` field — use corepack, or install it yourself at the same version.

```sh
cp .env.template .env      # then fill in DATABASE_URL and DISCORD_TOKEN
pnpm install
pnpm generate              # emits the Prisma client into src/generated (not committed)
pnpm migrate               # applies migrations
pnpm start
```

`pnpm typecheck` and `pnpm format:check` are what CI runs, alongside a Docker build.

## Deployment

`docker compose up --build`, or build the image and point it at an external Postgres.
`start.sh` applies migrations and then execs the bot; it exits non-zero if migrations
fail rather than starting against an unmigrated database.

The bot is a Discord gateway client and listens on no port, so the image exposes none.

## Layout

```
src/
  index.ts          bot entrypoint, scheduled update loop, event handlers
  fetch-manga.ts    routes each series to its scraper
  scrapers/         one module per source, all returning ScraperResult
  commands/         !add, !delete, !setcatalog, !setupdates, !subscriptions, !updatecatalog
  catalog-line.ts   renders and parses the catalog message (both halves, one file)
  db.ts             re-exports the generated Prisma client
  prisma.ts         the configured client — the only place the driver adapter is wired
scripts/            one-off maintenance scripts, safe by default, --apply to write
```

## Gotchas worth knowing

- **Chapter labels are not uniform.** WeebCentral publishes `Chapter 51`, `No. 107`,
  `Episode 267` and `Mag Version 236`. Only the trailing number is reliable; reading a
  fixed token position froze One-Punch Man on the literal string `"Version"`.
- **Scraped titles drift.** Series are joined back to database rows by URL, never by
  title — an upstream re-romanisation silently froze two series for months.
- **`latestChapter` only advances once a message is actually delivered**, otherwise a
  failed send would skip that chapter permanently.
