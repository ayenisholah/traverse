import { handleApiRequest, type Context } from "../../../../server/api.ts";
import { createPostGraphql } from "../../../../server/post-graphql.ts";
import { createRouterClient } from "../../../../server/router-client.ts";
import { createSandboxClient } from "../../../../server/sandbox-client.ts";
import { readSettings } from "../../../../server/settings.ts";

let context: Context | undefined;

// Built on the first request, because `next build` loads this module with no settings.
const handle = (request: Request): Promise<Response> => {
  if (context === undefined) {
    const settings = readSettings(process.env);
    context = {
      router: createRouterClient(createPostGraphql({ url: settings.publicRouterUrl, fetch })),
      sandbox: createSandboxClient(createPostGraphql({ url: settings.sandboxRouterUrl, fetch })),
    };
  }
  return handleApiRequest(request, context);
};

export { handle as GET, handle as POST };
