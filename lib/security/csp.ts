/**
 * The Content-Security-Policy header, which differs in ONE way outside production.
 *
 * `script-src` carries no `'unsafe-eval'` in production and must never gain one:
 * `content-collections` compiles MDX at build time precisely so that nothing has
 * to be evaluated in the browser, and `tests/e2e/guides.spec.ts` asserts its
 * absence against a real production build.
 *
 * React's DEVELOPMENT build does call `eval()`, for debugging features such as
 * reconstructing a callstack from another environment. Serving it the production
 * policy logged a CSP error on every `next dev` page load, forever, and cost
 * those features. A console with a permanent error in it is a console nobody
 * reads — which is how seven "Invalid DOM property" warnings sat unnoticed
 * beside it until someone opened the page (2026-09-18).
 *
 * Lives here rather than in `next.config.ts` so it can be tested directly;
 * importing the Next config would drag in the content-collections plugin.
 */

/**
 * `true` only for `next build` / `next start`; `next dev` sets "development".
 *
 * Takes a plain `string`, not the union TypeScript gives `process.env.NODE_ENV`:
 * the type is a convention, the runtime value is whatever the environment set,
 * and this switch fails OPEN (an unrecognised value adds `'unsafe-eval'`). The
 * comparison therefore has to be exact, and the test has to be able to hand it
 * "Production" and "prod" — which the narrow type forbade.
 */
export function isProductionBuild(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

export function contentSecurityPolicy(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (!isProductionBuild(nodeEnv)) scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://lh3.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
