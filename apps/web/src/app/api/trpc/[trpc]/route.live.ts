import { handleApiRequest } from "../../../../server/api.ts";
import { serverRuntime } from "../../../../server/runtime.ts";

const handle = async (request: Request): Promise<Response> => {
  const { base, auth } = serverRuntime();
  const session = auth ? await auth.session(request) : { accessToken: undefined, setCookies: [] };
  const answer = await handleApiRequest(request, { ...base, accessToken: session.accessToken });
  if (session.setCookies.length === 0) return answer;
  // A refreshed access token travels back on whatever answer this call gets.
  const headers = new Headers(answer.headers);
  for (const cookie of session.setCookies) headers.append("set-cookie", cookie);
  return new Response(answer.body, { status: answer.status, headers });
};

export { handle as GET, handle as POST };
