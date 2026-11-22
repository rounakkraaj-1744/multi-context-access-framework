import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { actorOrError, isAdmin } from "@/lib/api";

export async function GET() {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const paper = await readFile(resolve(process.cwd(), "complete_research_paper.pdf"));
  return new Response(new Uint8Array(paper), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="mcac-research-paper.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
