import { AuthError, currentActor, type Actor } from "./auth";

export function json(data: unknown, status=200) { return Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } }); }
export function error(code: string, message: string, status=400) { return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } }); }
export async function actorOrError(): Promise<{actor:Actor}|{response:Response}> {
  try { const actor=await currentActor(); return actor ? {actor} : {response:error("UNAUTHENTICATED","Sign in to continue.",401)}; }
  catch(e) { if(e instanceof AuthError) return {response:error(e.code,"Sign in to continue.",e.status)}; throw e; }
}
export function isAdmin(actor:Actor) { return actor.roles.includes("Admin") || actor.roles.includes("Super Admin"); }
export function isSuperAdmin(actor:Actor) { return actor.roles.includes("Super Admin"); }
