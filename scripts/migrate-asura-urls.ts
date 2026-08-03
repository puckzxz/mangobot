/**
 * Repoints stored AsuraScans series URLs at the current site.
 *
 *   asuracomic.net/series/<slug>-<per-series-hash>  ->  asurascans.com/comics/<slug>
 *
 * The old domain 301s to its bare homepage with the path discarded, which is why
 * every Asura series silently stopped updating. The new URLs are stored hash-free
 * on purpose: Asura appends a global build hash and 302s to the current one, so a
 * hash-free URL keeps working across their rebuilds.
 *
 * RUN THIS AFTER DEPLOYING, not before — the previously deployed scraper drives
 * puppeteer against the old markup, so migrating first just changes which URL it
 * fails on.
 *
 *   bun run scripts/migrate-asura-urls.ts            # dry run, verifies every URL
 *   bun run scripts/migrate-asura-urls.ts --apply    # writes
 *
 * Idempotent: rows already on the new shape are skipped.
 */
// Shares the configured client rather than constructing its own — Prisma 7 needs a
// driver adapter, and there should only be one place that wires it up.
import prisma from "../src/prisma";
import { asuraSeriesUrl, asuraSlug } from "../src/scrapers/asura";
import { USER_AGENT } from "../src/user-agent";

const apply = process.argv.includes("--apply");

const series = await prisma.series.findMany({
  where: { source: "AsuraScans" },
  select: { id: true, name: true, url: true },
  orderBy: { name: "asc" },
});

console.log(`${series.length} AsuraScans series; ${apply ? "APPLYING" : "dry run"}\n`);

let migrated = 0;
let skipped = 0;
let unreachable = 0;

for (const [index, s] of series.entries()) {
  const target = asuraSeriesUrl(asuraSlug(s.url));

  if (s.url === target) {
    skipped++;
    continue;
  }

  // Verify before writing: a slug that no longer exists upstream should be
  // reported rather than quietly persisted as another dead URL.
  if (index > 0) await Bun.sleep(400);
  const response = await fetch(target, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (!response.ok) {
    console.log(`  UNREACHABLE (${response.status})  ${s.name}\n      ${target}`);
    unreachable++;
    continue;
  }

  console.log(`  ${apply ? "migrate" : "would migrate"}  ${s.name}\n      ${s.url}\n   -> ${target}`);
  if (apply) {
    await prisma.series.update({ where: { id: s.id }, data: { url: target } });
  }
  migrated++;
}

console.log(
  `\n${apply ? "migrated" : "would migrate"}=${migrated}  already-current=${skipped}  unreachable=${unreachable}`
);
if (!apply && migrated > 0) console.log("re-run with --apply to write.");

await prisma.$disconnect();
