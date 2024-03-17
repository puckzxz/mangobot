import { SeriesSource } from "@prisma/client";

export interface Scrape {
  type: "scrape";
  data: Array<{
    url: string;
    source: SeriesSource;
  }>;
}

export interface CheckId {
  type: 'checkId';
  data: {
    source: SeriesSource;
  }
}

export type Task = Scrape | CheckId;
