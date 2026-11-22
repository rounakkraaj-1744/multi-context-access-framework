import { initialize } from "@/lib/seed";
import { json, error } from "@/lib/api";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return error("NOT_AVAILABLE", "Initialization is disabled in production.", 404);
  const token = process.env.INIT_TOKEN;
  if (token && request.headers.get("x-init-token") !== token)
    return error("FORBIDDEN", "Invalid initialization token.", 403);
  initialize();
  return json({ initialized: true });
}
