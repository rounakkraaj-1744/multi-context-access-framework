import { z } from "zod";
import { sqlite, audit } from "@/lib/db";
import { error, json } from "@/lib/api";
import { createSession, verifyPassword } from "@/lib/auth";

const attempts=new Map<string,{count:number;until:number}>();
export async function POST(req:Request){
 const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown"; const current=attempts.get(ip); if(current&&current.until>Date.now()&&current.count>=10)return error("RATE_LIMITED","Too many attempts. Try again shortly.",429);
 const body=await req.json().catch(()=>null); const parsed=z.object({email:z.email(),password:z.string().min(1)}).safeParse(body); if(!parsed.success)return error("INVALID_CREDENTIALS","Email or password is incorrect.",401);
 const user=sqlite.prepare("SELECT id,password_hash,status FROM users WHERE email=?").get(parsed.data.email) as {id:string;password_hash:string;status:string}|undefined;
 if(!user||!verifyPassword(parsed.data.password,user.password_hash)||user.status!=="ACTIVE") {attempts.set(ip,{count:(current?.count??0)+1,until:Date.now()+15*60*1000});audit(null,"LOGIN_FAILED",user?.id??null,{reasonCode:!user?"UNKNOWN_ACCOUNT":user.status!=="ACTIVE"?"ACCOUNT_NOT_ACTIVE":"INVALID_CREDENTIALS"});return error("INVALID_CREDENTIALS","Email or password is incorrect, or the account is awaiting approval.",401);}
 attempts.delete(ip); await createSession(user.id,req); audit(user.id,"LOGIN_SUCCEEDED",user.id,{}); return json({authenticated:true});
}
