import { actorOrError, json } from "@/lib/api";

export async function GET() {
  const res = await actorOrError();
  if ("response" in res) return res.response;
  return json(res.actor);
}
