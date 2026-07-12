// Test-only shim for Astro's `astro:middleware` virtual module. Astro's real
// `defineMiddleware` is an identity wrapper, so mirroring it lets the genuine
// `src/middleware.ts` onRequest be imported and driven directly in Vitest
// without pulling in Astro's build pipeline. Vitest aliases the specifier to
// this file (see vitest.config.ts).
export function defineMiddleware<T>(onRequest: T): T {
  return onRequest;
}
