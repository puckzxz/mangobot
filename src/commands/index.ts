import { Command } from "../types/command";
import add from "./add";
import del from "./delete";
import setcatalog from "./setcatalog";
import setupdates from "./setupdates";
import subscriptions from "./subscriptions";
import updatecatalog from "./updatecatalog";

/**
 * Static registry. Commands used to be discovered with `fs.readdirSync` plus
 * `require` at runtime, which meant a non-root working directory produced ENOENT
 * inside an event handler — the bot would connect, load zero commands and ignore
 * everything silently — and a missing default export was a runtime TypeError the
 * compiler could not see.
 */
export const commands: Command[] = [add, del, setcatalog, setupdates, subscriptions, updatecatalog];

export const commandsByName = new Map(commands.map((command) => [command.name, command]));
