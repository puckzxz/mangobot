import { encode, decode } from "./coder";
import { Task } from "./types/task";

export async function dispatchToSidecar<T>(data: Task): Promise<T> {
  const encoded = encode(data);
  const child = Bun.spawn(["bun", "src/sidecar.ts", encoded]);
  const rawReturn = await new Response(child.stdout).text();
  const errorMessage = await new Response(child.stderr).text();
  if (errorMessage) {
    console.error(errorMessage);
    return [] as T;
  }
  try {
    await child.exited;
    return decode<T>(rawReturn);
  } catch (error) {
    console.error(error);
    return [] as T;
  }
}
