import { handleApiRequest } from "../../../../server/api.ts";
import { createRouterClient, type RouterClient } from "../../../../server/router-client.ts";
import { readSettings } from "../../../../server/settings.ts";

let router: RouterClient | undefined;

// Built on the first request, because `next build` loads this module with no settings.
export const GET = (request: Request): Promise<Response> => {
  router ??= createRouterClient({ url: readSettings(process.env).publicRouterUrl, fetch });
  return handleApiRequest(request, router);
};
