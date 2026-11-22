import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { sqlite } from "@/lib/db";
import Portal from "@/app/portal";

export default async function PortalPage({
  initialSection = "Overview",
  requireAuth = false,
  requireAdmin = false,
}: {
  initialSection?: string;
  requireAuth?: boolean;
  requireAdmin?: boolean;
}) {
  const actor = await currentActor();
  if (!actor && requireAuth) redirect("/");
  if (requireAdmin && actor && !actor.roles.some((role) => role === "Admin" || role === "Super Admin")) redirect("/portal");
  const resources = actor
    ? (sqlite
        .prepare("SELECT id,title,resource_type,classification FROM resources ORDER BY title")
        .all() as { id: string; title: string; resource_type: string; classification: string }[])
    : [];
  const notices = actor
    ? (sqlite
        .prepare(
          "SELECT id,title,summary,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 5",
        )
        .all(actor.id) as {
        id: string;
        title: string;
        summary: string;
        created_at: string;
        read_at: string | null;
      }[])
    : [];
  return <Portal actor={actor} resources={resources} notices={notices} initialSection={initialSection} />;
}
