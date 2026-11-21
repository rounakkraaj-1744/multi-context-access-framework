import {existsSync} from "node:fs";
import {loadEnvFile} from "node:process";
// Load the same local configuration before importing the DB module, which captures DATABASE_PATH at startup.
for(const file of [".env.local",".env"])if(existsSync(file))loadEnvFile(file);
const {initialize}=await import("../lib/seed.ts");
const accounts=initialize();
console.log("MCAF schema and development role templates are ready.");
if(accounts.superAdminEmail)console.log(`Super Admin account is configured: ${accounts.superAdminEmail}`);
if(accounts.adminEmail)console.log(`Admin account is configured: ${accounts.adminEmail}`);
console.log("Existing matching accounts are left unchanged. Development seed passwords are listed in .env.example; use them only for local setup.");
