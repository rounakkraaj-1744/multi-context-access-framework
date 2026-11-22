import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { evaluateAccess, evaluateRbac, type AccessContext, type Policy } from "../lib/authorization.ts";

const out = "research-evaluation/raw-results";
mkdirSync(out, { recursive: true });
const seed = 20261031;
const scenarios = [
  ["normal","BENIGN",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"ALLOW"],
  ["device","VIOLATING",{businessHours:true,registeredDevice:false,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["hours","VIOLATING",{businessHours:false,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["network","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:false,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["rate","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:99,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["sequence","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:true,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["missing","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:false,contextAgeSeconds:0},"DENY"],
  ["stale","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:600},"DENY"],
  ["conflict","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["no-perm","VIOLATING",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["failed","VIOLATING",{businessHours:false,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"DENY"],
  ["stepup","BENIGN",{businessHours:true,registeredDevice:true,networkKnown:true,requestsInWindow:1,unusualSequence:false,contextAvailable:true,contextAgeSeconds:0},"STEP_UP_AUTH"],
] as const;
type Family = typeof scenarios[number];
const context = (delta: Record<string, unknown>) => ({ now:new Date("2026-10-31T10:00:00.000Z"),stepUpVerified:false,...delta }) as AccessContext;
const normalPolicy: Policy = {id:"grant",effect:"ALLOW",businessHoursOnly:true,registeredDeviceOnly:true,knownNetworkOnly:true,maxRequests:20,denyUnusualSequence:true,maxContextAgeSeconds:300};
const rows = scenarios.map(([id,intent,input]) => {
  const permissions = id === "no-perm" ? [] : ["resources:engineering:read"];
  const policies: Policy[] = id === "stepup" ? [{id:"step",effect:"STEP_UP_AUTH"}] : id === "conflict" ? [{id:"allow",effect:"ALLOW"},{id:"deny",effect:"DENY"}] : [normalPolicy];
  const result = evaluateAccess({permissions,requiredPermission:"resources:engineering:read",context:context(input),policies});
  return {id,intent,input,expected: scenarios.find(x=>x[0]===id)?.[3],actual:result.decision,reasonCodes:result.reasonCodes,baseline: id === "no-perm" ? evaluateRbac([],"resources:engineering:read") : evaluateRbac(["resources:engineering:read"],"resources:engineering:read"),sensitivity:id==="normal"||id==="stepup"?"LOW":"HIGH",stepUpOutcome:result.decision==="STEP_UP_AUTH"?"NOT_SIMULATED":"N/A"};
});
const pct = (n:number,d:number) => d ? n/d : null;
const metricRows = rows.map(row=>({
 ...row, accepted:row.actual==="ALLOW", verify:row.actual==="STEP_UP_AUTH", denied:row.actual==="DENY",
}));
function metrics(items: typeof metricRows) {
 const v=items.filter(x=>x.intent==="VIOLATING"), b=items.filter(x=>x.intent==="BENIGN");
 const tp=v.filter(x=>x.actual!=="ALLOW").length, fp=v.length-tp, fn=b.filter(x=>x.actual==="DENY").length, cr=b.filter(x=>x.actual==="STEP_UP_AUTH").length;
 const precision=pct(tp,tp+b.filter(x=>x.actual!=="ALLOW").length); const recall=pct(tp,v.length); const f1=precision===null||recall===null||precision+recall===0?null:2*precision*recall/(precision+recall);
 return {n:items.length,benign:b.length,violating:v.length,FAR:pct(fp,v.length),FRR:pct(fn,b.length),CR:pct(cr,b.length),verificationBurden:pct(cr,b.length),containmentRate:pct(tp,v.length),endToEndFAR:pct(fp,v.length),precision,recall,f1,decisionDistribution:Object.fromEntries(["ALLOW","STEP_UP_AUTH","DENY"].map(k=>[k,items.filter(x=>x.actual===k).length]))};
}
const familyMetrics=Object.fromEntries([...new Set(rows.map(r=>r.id))].map(id=>[id,metrics(metricRows.filter(x=>x.id===id))]));
const all=metrics(metricRows);
const perf: number[]=[]; const warm=1000, samples=10000;
for(let i=0;i<warm;i++) evaluateAccess({permissions:["resources:engineering:read"],requiredPermission:"resources:engineering:read",context:context(rows[i%rows.length].input as Record<string,unknown>),policies:[normalPolicy]});
for(let i=0;i<samples;i++){const row=rows[i%rows.length];const s=performance.now();evaluateAccess({permissions:row.id==="no-perm"?[]:["resources:engineering:read"],requiredPermission:"resources:engineering:read",context:context(row.input as Record<string,unknown>),policies:row.id==="stepup"?[{id:"step",effect:"STEP_UP_AUTH"}]:[normalPolicy]});perf.push((performance.now()-s)*1000);}
perf.sort((a,b)=>a-b); const percentile=(p:number)=>perf[Math.min(perf.length-1,Math.ceil(perf.length*p)-1)];
const summary={seed,generatedAt:new Date().toISOString(),source:"lib/seed.ts exact stored scenario definitions",scenarioCount:12,requestCount:12,intentDistribution:{benign:rows.filter(x=>x.intent==="BENIGN").length,violating:rows.filter(x=>x.intent==="VIOLATING").length},calibrationSeed:null,evaluationSeed:seed,scenarioFamilyDistribution:Object.fromEntries(rows.map(r=>[r.id,1])),resourceSensitivityDistribution:{low:2,high:10},contextDegradationRate:null,evaluationParameters:{baselinePermission:"resources:engineering:read",policy:{businessHoursOnly:true,registeredDeviceOnly:true,knownNetworkOnly:true,maxRequests:20,denyUnusualSequence:true,maxContextAgeSeconds:300},note:"Exact evaluator policies used by existing Scenario Lab; not six paper baselines."},all,perFamily:familyMetrics,decisions:metricRows};
const latency={system:"current evaluateAccess pure decision function",runtime:process.version,sampleCount:samples,warmupCount:warm,unit:"microseconds",mean:perf.reduce((a,b)=>a+b,0)/perf.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),min:perf[0],max:perf.at(-1),throughputPerSecond:samples/(perf.reduce((a,b)=>a+b,0)/1e6)};
writeFileSync(`${out}/dataset.json`,JSON.stringify({seed,scenarios:rows},null,2));
writeFileSync(`${out}/evaluation.json`,JSON.stringify(summary,null,2));
writeFileSync(`${out}/decision-rows.csv`,["id,intent,actual,reason_codes,expected","..."].slice(0,1).join("\n")+"\n"+rows.map(r=>[r.id,r.intent,r.actual,`"${r.reasonCodes.join("|")}"`,r.expected].join(",")).join("\n")+"\n");
writeFileSync(`${out}/latency.json`,JSON.stringify(latency,null,2));
const canonical=(x:unknown)=>JSON.stringify(x);
const hash=(x:unknown)=>createHash("sha256").update(canonical(x)).digest("hex");
const chain=[{id:"a",event:"ALLOW",details:{x:1}},{id:"b",event:"DENY",details:{x:2}},{id:"c",event:"STEP_UP",details:{x:3}}].map((r,i,a)=>({ ...r,previousHash:i?hash({...a[i-1],previousHash:i>1?hash({...a[i-2],previousHash:"0"}):"0"}):"0",hash:""}));
// No production hash chain exists; record that tamper verification is therefore unavailable.
writeFileSync(`${out}/audit-checks.json`,JSON.stringify({productionHashChainImplemented:false,tests:{modifyExistingRecord:"NOT APPLICABLE — no hash chain",modifyPreviousHash:"NOT APPLICABLE — no hash chain",deleteIntermediateRecord:"NOT APPLICABLE — no hash chain",reorderRecords:"NOT APPLICABLE — no hash chain",truncateLatestRecords:"NOT APPLICABLE — no hash chain",chainFixture:"synthetic fixture only; no claim about production audit integrity"},auditEventCountImplementation:"plain SQLite audit_events rows without hash fields"},null,2));
console.log(JSON.stringify({out,summary,latency},null,2));
