-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_subscriptions_guild_id" ON "subscriptions"("guild_id");

-- CreateIndex
CREATE INDEX "index_subscriptions_series_id" ON "subscriptions"("series_id");

-- CreateIndex
CREATE INDEX "index_subscriptions_user_id" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_guild_id_series_id_user_id_key" ON "subscriptions"("guild_id", "series_id", "user_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
