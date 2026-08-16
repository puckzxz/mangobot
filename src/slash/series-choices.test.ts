import { describe, expect, test } from "bun:test";
import { MAX_CHOICES, MAX_LABEL, type SeriesChoice, buildChoices } from "./series-choices";

const entry = (name: string, subscribed = false, id = name): SeriesChoice => ({ id, name, subscribed });

/** Titles taken from the real catalog, because that is where the collisions are. */
const CATALOG = [
  entry("Return of the Mount Hua Sect"),
  entry("The Regressed Son of a Duke is an Assassin"),
  entry("Returning With Absolutely Nothing", true),
  entry("The Return of the Crazy Demon"),
  entry("Omniscient Reader’s Viewpoint", true),
];

describe("buildChoices", () => {
  test("an empty query offers the catalog in its own order", () => {
    expect(buildChoices(CATALOG, "").map((c) => c.value)).toEqual(CATALOG.map((c) => c.name));
  });

  /**
   * Typing "return" must not bury the two titles that start with it beneath the one
   * that merely contains it. "The Regressed Son…" shares a prefix with the query by
   * eye but not by string, and is correctly absent.
   */
  test("prefix matches rank above mere substring matches", () => {
    expect(buildChoices(CATALOG, "return").map((c) => c.value)).toEqual([
      "Return of the Mount Hua Sect",
      "Returning With Absolutely Nothing",
      "The Return of the Crazy Demon",
    ]);
  });

  test("non-matching entries are dropped, not merely deprioritised", () => {
    expect(buildChoices(CATALOG, "omniscient")).toHaveLength(1);
    expect(buildChoices(CATALOG, "nothing at all matches this")).toEqual([]);
  });

  test("matching ignores case and surrounding whitespace", () => {
    expect(buildChoices(CATALOG, "  MOUNT hua  ")).toHaveLength(1);
  });

  /** The value is the series id; only the label is decorated. */
  test("already-subscribed entries are ticked without changing their value", () => {
    const [choice] = buildChoices([entry("Vinland Saga", true, "abc-123")], "vinland");
    expect(choice).toEqual({ name: "✓ Vinland Saga", value: "abc-123" });
  });

  test("unsubscribed entries carry no marker", () => {
    expect(buildChoices([entry("Vinland Saga", false, "abc-123")], "")[0]!.name).toBe("Vinland Saga");
  });

  /**
   * Discord rejects the whole response if any label exceeds 100 characters or more
   * than 25 are sent, so both limits are enforced here rather than discovered in
   * production as a command that silently stops suggesting anything.
   */
  test("never exceeds Discord's 25-choice limit", () => {
    const many = Array.from({ length: 80 }, (_, i) => entry(`Series ${i}`, false, `id-${i}`));
    expect(buildChoices(many, "")).toHaveLength(MAX_CHOICES);
  });

  test("long titles are truncated to fit, tick included", () => {
    const long = "A".repeat(200);
    for (const subscribed of [false, true]) {
      const [choice] = buildChoices([entry(long, subscribed)], "");
      expect(choice!.name.length).toBeLessThanOrEqual(MAX_LABEL);
      expect(choice!.name.endsWith("…")).toBe(true);
    }
  });

  test("a title exactly at the limit is left alone", () => {
    const exact = "B".repeat(MAX_LABEL);
    expect(buildChoices([entry(exact)], "")[0]!.name).toBe(exact);
  });
});
