import { createHash } from "node:crypto";
import { sqlite } from "../db";
import { freezePolicyVersion, assertPolicyVersionTransition } from "./policy-version";
import { canonicalJson, verifyTraceHash } from "./trace";
import type { McacTrace, PolicyVersion } from "./types";

/** Application persistence boundary. The domain engine does not import this module. */
export function storePolicyVersion(policy: PolicyVersion, createdAt: string, parentVersion: string | null = null): void {
  const snapshot = freezePolicyVersion(policy);
  const serialized = canonicalJson(snapshot);
  const digest = sha256(serialized);
  const insert = sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT snapshot_hash FROM mcac_policy_versions WHERE version=?").get(snapshot.version) as { snapshot_hash: string } | undefined;
    if (existing) {
      if (existing.snapshot_hash !== digest) throw new Error(`Immutable policy version ${snapshot.version} already exists with different content`);
      return;
    }
    if (parentVersion) {
      const parent = loadPolicyVersion(parentVersion);
      assertPolicyVersionTransition(parent, snapshot);
    }
    sqlite.prepare("INSERT INTO mcac_policy_versions(version,parent_version,snapshot,snapshot_hash,created_at) VALUES(?,?,?,?,?)")
      .run(snapshot.version, parentVersion, serialized, digest, createdAt);
  });
  insert();
}

export function loadPolicyVersion(version: string): PolicyVersion {
  const row = sqlite.prepare("SELECT snapshot,snapshot_hash FROM mcac_policy_versions WHERE version=?").get(version) as { snapshot: string; snapshot_hash: string } | undefined;
  if (!row) throw new Error(`MCAC policy version ${version} was not found`);
  if (sha256(row.snapshot) !== row.snapshot_hash) throw new Error(`MCAC policy version ${version} snapshot integrity check failed`);
  return freezePolicyVersion(JSON.parse(row.snapshot) as PolicyVersion);
}

/** Appends an immutable, SHA-256 chained trace. `createdAt` is explicit for replayable callers. */
export function storeDecisionTrace(trace: McacTrace, createdAt: string): void {
  if (!verifyTraceHash(trace)) throw new Error("Cannot persist a trace with an invalid record hash");
  const append = sqlite.transaction(() => {
    const policyExists = sqlite.prepare("SELECT 1 FROM mcac_policy_versions WHERE version=?").get(trace.policyVersion);
    if (!policyExists) throw new Error(`Cannot persist trace without archived policy version ${trace.policyVersion}`);
    const tail = sqlite.prepare("SELECT trace_hash FROM mcac_decision_traces ORDER BY rowid DESC LIMIT 1").get() as { trace_hash: string } | undefined;
    const expectedPrevious = tail?.trace_hash ?? "GENESIS";
    if (trace.previousHash !== expectedPrevious) throw new Error(`Trace chain discontinuity: expected previous hash ${expectedPrevious}`);
    sqlite.prepare("INSERT INTO mcac_decision_traces(trace_hash,request_id,policy_version,trace_json,created_at) VALUES(?,?,?,?,?)")
      .run(trace.hash, trace.requestId, trace.policyVersion, canonicalJson(trace), createdAt);
  });
  append();
}

export function loadDecisionTrace(requestId: string): McacTrace {
  const row = sqlite.prepare("SELECT trace_json FROM mcac_decision_traces WHERE request_id=?").get(requestId) as { trace_json: string } | undefined;
  if (!row) throw new Error(`MCAC trace ${requestId} was not found`);
  const trace = JSON.parse(row.trace_json) as McacTrace;
  if (!verifyTraceHash(trace)) throw new Error(`MCAC trace ${requestId} failed hash verification`);
  return trace;
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
