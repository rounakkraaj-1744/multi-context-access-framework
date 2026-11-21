import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { expireActiveSessions, id, now, sqlite } from "./db";

const COOKIE = "mcaf_session";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type Actor = { id: string; sessionId:string; name: string; email: string; status: string; organizationId: string; roles: string[]; permissions: string[] };
export async function currentActor(): Promise<Actor | null> {
  const jar = await cookies(); const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const timestamp=now();expireActiveSessions(timestamp);
  const session = sqlite.prepare("SELECT s.id,s.user_id,s.expires_at,s.status session_status,u.name,u.email,u.status account_status,u.organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").get(hashToken(token)) as {id:string;user_id:string;expires_at:string;session_status:string;name:string;email:string;account_status:string;organization_id:string}|undefined;
  if (!session) { jar.delete(COOKIE); return null; }
  if(session.account_status!=="ACTIVE"){
    sqlite.prepare("UPDATE sessions SET status='REVOKED',logout_at=?,reason='ACCOUNT_INACTIVE' WHERE id=? AND status='ACTIVE'").run(timestamp,session.id);
    jar.delete(COOKIE);return null;
  }
  if(session.session_status!=="ACTIVE"){jar.delete(COOKIE);return null;}
  if(session.expires_at<=timestamp){sqlite.prepare("UPDATE sessions SET status='EXPIRED',logout_at=expires_at,reason='INACTIVITY_TIMEOUT' WHERE id=? AND status='ACTIVE'").run(session.id);jar.delete(COOKIE);return null;}
  sqlite.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").run(timestamp,session.id);
  const roles = sqlite.prepare("SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?").all(session.user_id) as {name:string}[];
  const perms = sqlite.prepare("SELECT code FROM (SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? UNION SELECT p.code FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=?)").all(session.user_id,session.user_id) as {code:string}[];
  return {id:session.user_id,sessionId:session.id,name:session.name,email:session.email,status:session.account_status,organizationId:session.organization_id,roles:roles.map((r)=>r.name),permissions:perms.map((p)=>p.code)};
}
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor(); if (!actor) throw new AuthError(401,"UNAUTHENTICATED"); return actor;
}
export class AuthError extends Error { constructor(public status:number, public code:string){super(code);} }
export function hasRole(actor: Actor, ...roles: string[]) { return roles.some((role) => actor.roles.includes(role)); }
export function hasPermission(actor: Actor, permission: string) { return actor.permissions.includes(permission) || (actor.roles.includes("Super Admin") && actor.permissions.includes("platform:manage")); }
export function verifyPassword(password: string, hash: string) { return bcrypt.compareSync(password,hash); }
export async function createSession(userId: string, req: Request) {
  const token = randomBytes(32).toString("base64url"); const timestamp=now();
  const forwardedIp=process.env.TRUST_PROXY_HEADERS==="true"?req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??null:null;
  sqlite.prepare("INSERT INTO sessions(id,token_hash,user_id,login_at,last_seen_at,expires_at,status,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id(),hashToken(token),userId,timestamp,timestamp,new Date(Date.now()+8*60*60*1000).toISOString(),"ACTIVE",forwardedIp,req.headers.get("user-agent")?.slice(0,240)??null);
  const jar=await cookies(); jar.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",expires:new Date(Date.now()+8*60*60*1000)});
}
export async function destroySession() {
  const jar=await cookies(); const token=jar.get(COOKIE)?.value;
  if(token) sqlite.prepare("UPDATE sessions SET status='LOGGED_OUT',logout_at=?,reason='EXPLICIT_LOGOUT' WHERE token_hash=? AND status='ACTIVE'").run(now(),hashToken(token));
  jar.delete(COOKIE);
}
