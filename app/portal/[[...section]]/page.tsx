import { notFound } from "next/navigation";
import PortalPage from "@/app/portal-page";

export const instant = false;

const routeSections: Readonly<Record<string, string>> = {
  "": "Overview",
  users: "People",
  approvals: "Approvals",
  resources: "Resources",
  policies: "Policies",
  "mcac-drafts": "MCAC drafts",
  decisions: "Decisions",
  sessions: "Sessions",
  alerts: "Alerts",
  incidents: "Incidents",
  audit: "Audit",
  "context-lab": "Context lab",
  roles: "Roles",
  permissions: "Permissions",
  "permission-requests": "Permission requests",
  "access-history": "Access history",
  profile: "Profile",
  notifications: "Notifications",
  research: "Research Overview",
  "research/scenarios": "Scenario Explorer",
  "research/context": "Context Inspector",
  "research/gamma": "Γ Consistency Inspector",
  "research/theta": "Θ Threshold Inspector",
  "research/comparison": "RBAC vs MCAC",
  "research/traces": "Trace Explorer & Replay",
  "research/policies": "Research Policy",
  "research/architecture": "Architecture",
  "research/methodology": "Methodology",
  "research/paper": "Research Paper",
  "research/about": "About Project",
};

export default async function PortalRoute({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  const route = section.join("/");
  const initialSection = routeSections[route];
  if (!initialSection) notFound();
  const requireAdmin = ["users", "approvals", "resources", "policies", "mcac-drafts", "decisions", "sessions", "alerts", "incidents", "audit", "context-lab", "roles", "permissions", "permission-requests"].includes(route) || route.startsWith("research");
  return <PortalPage initialSection={initialSection} requireAuth requireAdmin={requireAdmin} />;
}
