#!/usr/bin/env sh
# Fail fast: never start the bot against a database whose migrations did not apply.
set -e

pnpm exec prisma migrate deploy

# exec, so bun replaces the shell as PID 1 and receives SIGTERM directly. Without
# it the shell holds PID 1, never forwards the signal, and the graceful shutdown in
# src/index.ts never runs — the container is SIGKILLed instead, which can land
# between a successful send and the row update and re-announce on restart.
# Invoking bun directly rather than `pnpm start` also drops a process layer.
exec bun run src/index.ts
