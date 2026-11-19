import { serverRuntime } from "../../server/runtime.ts";

const notFound = () => new Response(null, { status: 404 });

export const GET = (request: Request): Promise<Response> | Response =>
  serverRuntime().auth?.signIn(request) ?? notFound();
