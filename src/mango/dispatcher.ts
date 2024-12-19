import { encode, decode } from "./coder";
import { Task } from "../types/task";

export async function dispatchToSidecar<T>(data: Task): Promise<T> {
  const encoded = encode(data);
  const child = Bun.spawn(["bun", `${import.meta.dir}/sidecar.ts`, encoded]);
  const rawReturn = await new Response(child.stdout).text();
  await child.exited;
  return decode<T>(rawReturn);
}
