import bcrypt from "bcryptjs";
import { audit, id, now, notify, sqlite } from "./db.ts";

const permissions = [
 ["dashboard:read", "View dashboard"], ["users:read", "View scoped users"], ["registrations:review", "Review registrations"],
 ["permissions:manage", "Manage delegated permissions"], ["incidents:manage", "Investigate incidents"], ["reports:export", "Export scoped reports"],
 ["resources:project:read", "Read assigned project resources"], ["resources:engineering:read", "Read engineering documentation"],
 ["resources:hr:read", "Read permitted HR records"], ["resources:deployment:read", "Read deployment records"],
 ["resources:team:read", "Read team reports"], ["platform:manage", "Manage platform"], ["policies:manage", "Manage global policies"],
];
const roleDefs: Record<string, string[]> = {
  "Super Admin": permissions.map(([code]) => code as string), Admin: ["dashboard:read","users:read","registrations:review","permissions:manage","incidents:manage","reports:export"],
  HR: ["dashboard:read","resources:hr:read"], "Backend Engineer": ["dashboard:read","resources:project:read","resources:engineering:read"],
  "DevOps Engineer": ["dashboard:read","resources:deployment:read"], Manager: ["dashboard:read","resources:team:read"],
};

export function initialize() {
  const devDefaults = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
  const superAdminEmail = process.env.SEED_SUPERADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || (devDefaults ? "superadmin@mcaf.test" : undefined);
  const superAdminPassword = process.env.SEED_SUPERADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || (devDefaults ? "MCAF-SuperAdmin-Dev-2026!" : undefined);
  const adminEmail = process.env.SEED_ORG_ADMIN_EMAIL || (devDefaults ? "admin@mcaf.test" : undefined);
  const adminPassword = process.env.SEED_ORG_ADMIN_PASSWORD || (devDefaults ? "MCAF-Admin-Dev-2026!" : undefined);
  for (const [label,email,password] of [["Super Admin",superAdminEmail,superAdminPassword],["Admin",adminEmail,adminPassword]] as const) {
    if ((email && !password) || (!email && password)) throw new Error(`${label} seed requires both an email and password.`);
    if (password && password.length < 12) throw new Error(`${label} seed password must contain at least 12 characters.`);
  }
  const tx = sqlite.transaction(() => {
    for (const [code, description] of permissions) sqlite.prepare("INSERT OR IGNORE INTO permissions(id,code,description) VALUES(?,?,?)").run(code, code, description);
    for (const [role, codes] of Object.entries(roleDefs)) {
      sqlite.prepare("INSERT OR IGNORE INTO roles(id,name,description,scope) VALUES(?,?,?,?)").run(role, role, `${role} role template`, role === "Super Admin" ? "platform" : "organization");
      for (const code of codes) sqlite.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)").run(role, code);
    }
    for (const [rid, title, type, permission, classification, content] of [
      ["p-report","Q4 Project Report","project","resources:project:read","Internal","Project performance summary for the fourth quarter."],
      ["e-guide","Engineering Handbook","engineering","resources:engineering:read","Internal","Engineering standards and service ownership guide."],
      ["h-policy","Leave Policy","hr","resources:hr:read","Confidential","Human resources leave and benefits policy."],
      ["d-deploy","Deployment Overview","deployment","resources:deployment:read","Internal","Current deployment schedule and operational notes."],
      ["m-team","Team Summary","team","resources:team:read","Internal","Team delivery and staffing summary."],
    ]) sqlite.prepare("INSERT OR IGNORE INTO resources(id,title,resource_type,required_permission,classification,content) VALUES(?,?,?,?,?,?)").run(rid,title,type,permission,classification,content);
    const scenarios = [
      ["normal","Normal access during permitted hours","ALLOW",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["device","Unregistered device","DENY",{businessHours:true,registeredDevice:false,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["hours","Outside permitted hours","DENY",{businessHours:false,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["network","Unknown network","DENY",{businessHours:true,registeredDevice:true,networkKnown:false,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["rate","Excessive request frequency","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:99,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["sequence","Unusual access sequence","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:true,contextAvailable:true,contextAgeSeconds:0}],
      ["missing","Missing context","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:false,contextAgeSeconds:0}],
      ["stale","Stale context","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:600}],
      ["conflict","Conflicting policies","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["no-perm","No required permission","DENY",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["failed","Failed contextual condition","DENY",{businessHours:false,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
      ["stepup","Step-up authentication required","STEP_UP_AUTH",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0}],
    ] as const;
    for (const [sid,name,expected,input] of scenarios) sqlite.prepare("INSERT OR IGNORE INTO scenarios(id,name,synthetic,input,expected) VALUES(?,?,1,?,?)").run(sid,name,JSON.stringify(input),expected);
    const seedAccount=(email:string|undefined,password:string|undefined,name:string,role:string)=>{
      if(!email||!password)return;
      // Never reset passwords, promote, or otherwise mutate an existing account by email.
      if(sqlite.prepare("SELECT id FROM users WHERE email=?").get(email))return;
      const userId=id();const timestamp=now();
      sqlite.prepare("INSERT INTO users(id,name,email,password_hash,status,organization_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(userId,name,email,bcrypt.hashSync(password,12),"ACTIVE","default",timestamp,timestamp);
      sqlite.prepare("INSERT INTO user_roles(user_id,role_id,assigned_by,assigned_at) VALUES(?,?,NULL,?)").run(userId,role,timestamp);
      audit(null,`${role.toUpperCase().replaceAll(" ","_")}_INITIALIZED`,userId,{method:"development initializer",synthetic:false});
      return userId;
    };
    const superAdminId=seedAccount(superAdminEmail,superAdminPassword,"Platform Super Administrator","Super Admin");
    seedAccount(adminEmail,adminPassword,"Organization Administrator","Admin");
    if(superAdminId)for(const user of sqlite.prepare("SELECT id FROM users WHERE id != ? AND status='ACTIVE'").all(superAdminId) as {id:string}[])notify(user.id,"platform.seed","Platform initialized","The development platform was initialized.",superAdminId);
  });
  tx();
  return {superAdminEmail:superAdminEmail??null,adminEmail:adminEmail??null};
}
