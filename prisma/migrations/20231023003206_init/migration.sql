-- CreateEnum
CREATE TYPE "SeriesSource" AS ENUM ('MangaSee', 'MangaDex', 'AsuraScans');

-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updates_channel_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "latest_chapter" TEXT NOT NULL DEFAULT '0',
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "SeriesSource" NOT NULL,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guilds_series" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_guilds_guild_id" ON "guilds"("id");

-- CreateIndex
CREATE INDEX "index_guilds_updates_channel_id" ON "guilds"("updates_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "series_name_key" ON "series"("name");

-- CreateIndex
CREATE UNIQUE INDEX "series_url_key" ON "series"("url");

-- CreateIndex
CREATE INDEX "index_guilds_series_guild_id" ON "guilds_series"("guild_id");

-- CreateIndex
CREATE INDEX "index_guilds_series_series_id" ON "guilds_series"("series_id");

-- CreateIndex
CREATE UNIQUE INDEX "guilds_series_guild_id_series_id_key" ON "guilds_series"("guild_id", "series_id");

-- AddForeignKey
ALTER TABLE "guilds_series" ADD CONSTRAINT "guilds_series_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guilds_series" ADD CONSTRAINT "guilds_series_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
