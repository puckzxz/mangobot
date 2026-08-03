#!/usr/bin/env sh
# Fail fast: never start the bot against a database whose migrations did not apply.
set -e

pnpm exec prisma migrate deploy
pnpm start
