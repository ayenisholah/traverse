import { serverRuntime } from "../../server/runtime.ts";

const notFound = () => new Response(null, { status: 404 });

// POST only, so a link or an image on another page can't sign someone out.
export const POST = (request: Request): Promise<Response> | Response =>
  serverRuntime().auth?.signOut(request) ?? notFound();
