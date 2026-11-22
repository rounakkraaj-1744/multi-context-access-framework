import { actorOrError, isAdmin, json } from "@/lib/api";
import { sqlite, id, now } from "@/lib/db";
import { evaluateAccess, evaluateRbac, type AccessContext, type Policy } from "@/lib/authorization";
export async function GET() {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  return json({
    scenarios: sqlite
      .prepare("SELECT id,name,synthetic,input,expected FROM scenarios ORDER BY id")
      .all(),
    runs: sqlite.prepare("SELECT * FROM scenario_runs ORDER BY created_at DESC LIMIT 50").all(),
  });
}
export async function POST() {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const scenarios = sqlite.prepare("SELECT * FROM scenarios ORDER BY id").all() as {
    id: string;
    name: string;
    input: string;
    expected: string;
  }[];
  const results = [];
  for (const s of scenarios) {
    const start = performance.now();
    const c = { now: new Date(), stepUpVerified: false, ...JSON.parse(s.input) } as AccessContext;
    const permissions = s.id === "no-perm" ? [] : ["resources:engineering:read"];
    const policies: Policy[] =
      s.id === "stepup"
        ? [{ id: "step", effect: "STEP_UP_AUTH" }]
        : s.id === "conflict"
          ? [
              { id: "allow", effect: "ALLOW" },
              { id: "deny", effect: "DENY" },
            ]
          : [
              {
                id: "context",
                effect: "ALLOW",
                businessHoursOnly: true,
                registeredDeviceOnly: true,
                knownNetworkOnly: true,
                maxRequests: 20,
                denyUnusualSequence: true,
                maxContextAgeSeconds: 300,
              },
            ];
    const result = evaluateAccess({
      permissions,
      requiredPermission: "resources:engineering:read",
      context: c,
      policies,
    });
    const actual = result.decision;
    const rbacBaseline = evaluateRbac(permissions, "resources:engineering:read");
    const latency = performance.now() - start;
    sqlite
      .prepare(
        "INSERT INTO scenario_runs(id,scenario_id,actual,matches_expected,latency_ms,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id(), s.id, actual, actual === s.expected ? 1 : 0, latency, now());
    results.push({
      id: s.id,
      name: s.name,
      expected: s.expected,
      actual,
      matchesExpected: actual === s.expected,
      reasonCodes: result.reasonCodes,
      explanation: result.explanation,
      latencyMs: latency,
      rbacBaseline,
    });
  }
  const latencies = results.map((x) => x.latencyMs).sort((a, b) => a - b);
  const median =
    latencies.length % 2
      ? latencies[Math.floor(latencies.length / 2)]
      : (latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2;
  return json({
    results,
    metrics: {
      runs: results.length,
      accuracy: results.filter((x) => x.matchesExpected).length / results.length,
      medianLatencyMs: median,
      p95LatencyMs:
        latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)],
      synthetic: true,
    },
  });
}
