import { onRequest } from "@/middleware";

// Drive the REAL src/middleware.ts onRequest against a synthetic request so a
// test can assert what the gate did: did it redirect, did it call next(), and
// what did it resolve locals.user to. The middleware only reads
// request/url/cookies/locals/redirect, so we build a minimal APIContext.

export interface RunMiddlewareOptions {
  pathname: string;
  cookieHeader?: string;
}

export interface RunMiddlewareResult {
  response: Response;
  nextCalled: boolean;
  locals: { user: unknown };
}

// Minimal AstroCookies stand-in. The middleware's Supabase client reads cookies
// from the request's Cookie header (via parseCookieHeader), not from here — this
// only needs to accept the setAll writes getUser() may make during a refresh.
function createFakeCookies() {
  const store = new Map<string, string>();
  return {
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    },
  };
}

export async function runMiddleware(options: RunMiddlewareOptions): Promise<RunMiddlewareResult> {
  const { pathname, cookieHeader } = options;

  const headers = new Headers();
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  const url = new URL(`http://127.0.0.1${pathname}`);
  const request = new Request(url, { headers });

  let nextCalled = false;
  const next = (): Promise<Response> => {
    nextCalled = true;
    return Promise.resolve(new Response("OK", { status: 200 }));
  };

  const locals: { user: unknown } = { user: undefined };

  const context = {
    request,
    url,
    cookies: createFakeCookies(),
    locals,
    redirect(path: string, status = 302): Response {
      return new Response(null, { status, headers: { Location: path } });
    },
  };

  type MiddlewareArgs = Parameters<typeof onRequest>;
  const response = await onRequest(context as unknown as MiddlewareArgs[0], next);

  return { response, nextCalled, locals };
}
