export interface Chapter {
  result: string;
  response: string;
  data: Datum[];
  limit: number;
  offset: number;
  total: number;
}

export interface Datum {
  id: string;
  type: string;
  attributes: Attributes;
  relationships: Relationship[];
}

export interface Attributes {
  volume: string | null;
  /** Null for oneshots and some specials — never assume this parses as a number. */
  chapter: string | null;
  title: string | null;
  translatedLanguage: string;
  /** A real URL when the chapter is hosted elsewhere (Manga Plus, webnovel sites). */
  externalUrl: string | null;
  publishAt: string;
  readableAt: string;
  createdAt: string;
  updatedAt: string;
  pages: number;
  version: number;
}

/**
 * Only the `manga` relationship carries `attributes`, and only when the request
 * asked for it via `includes[]`. `scanlation_group` and `user` relationships come
 * back with no `attributes` key at all, so it must be optional.
 */
export interface Relationship {
  id: string;
  type: string;
  attributes?: {
    /**
     * Keyed by language. There is NO guarantee of an `en` key — MangaDex stores the
     * canonical title in its original language, so Frieren returns only `ja-ro`.
     */
    title?: Record<string, string | undefined>;
    altTitles?: Array<Record<string, string | undefined>>;
  };
}
