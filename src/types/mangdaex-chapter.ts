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
  volume: null;
  chapter: string;
  title: string;
  translatedLanguage: string;
  externalUrl: null;
  publishAt: Date;
  readableAt: Date;
  createdAt: Date;
  updatedAt: Date;
  pages: number;
  version: number;
}

export interface Relationship {
  id: string;
  type: string;
  attributes: {
    title: {
      en: string;
    };
  };
}
