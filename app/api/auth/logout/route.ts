import { destroySession, currentActor } from "@/lib/auth";
import { audit } from "@/lib/db";
import { json } from "@/lib/api";

export async function POST() {
  const actor = await currentActor();
  await destroySession();
  if (actor) audit(actor.id, "LOGOUT_SUCCEEDED", actor.id, {});
  return json({ authenticated: false });
}
