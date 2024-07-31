import { SeriesSource } from "@prisma/client";

export interface Scrape {
  type: "scrape";
  data: Array<{
    url: string;
    source: SeriesSource;
  }>;
}

export type Task = Scrape
