import { config } from "./config";

export async function track(name: string, id: string) {
  const url = config.get("events.endpoint");
  await fetch(url, { method: "POST", body: JSON.stringify({ name, id }) });
}
