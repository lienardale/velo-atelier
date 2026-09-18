import { withContentCollections } from "@content-collections/next";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { contentSecurityPolicy } from "./lib/security/csp";

// `withContentCollections` compiles content/** at build time (content-collections.ts, W1-T4).
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  /**
   * Normalised to a literal so the build-time gate can actually be folded away.
   *
   * Next only inlines a `NEXT_PUBLIC_*` variable that EXISTS at build time. Left
   * unset, `process.env.NEXT_PUBLIC_TEST_HOOKS === "1"` in
   * `components/bike3d/BikeViewer.tsx` stays a runtime expression: the probe is
   * `null` and never mounts, but its `import()` stays in the module graph and
   * `window.__va` — a remote control for the viewer — ships in the bundle
   * (caught by `scripts/bundle-guard.ts`, 2026-09-17). Defining it here makes
   * the comparison `"0" === "1"`, which the compiler drops along with the
   * import. §3.6 AC7.
   */
  env: { NEXT_PUBLIC_TEST_HOOKS: process.env.NEXT_PUBLIC_TEST_HOOKS === "1" ? "1" : "0" },
  // A stray /Users/alienard/Code/pnpm-lock.yaml makes Next infer the wrong workspace
  // root. All builds run from the repo root, so pin it explicitly.
  // (`__dirname` is not available under ESM config files — use `process.cwd()`.)
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
  // Guest import payloads are capped at 256 KB by zod; 512 KB leaves head-room.
  // Deliberately NO `allowedOrigins` entry — Next's own Origin check plus
  // `assertSameOrigin()` in every action is the CSRF defence.
  experimental: { serverActions: { bodySizeLimit: "512kb" } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            // Static CSP, no nonce: a nonce would force every route dynamic.
            // A nonce-based CSP is tracked in docs/backlog.md.
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(),
          },
        ],
      },
    ];
  },
};

export default withContentCollections(withNextIntl(config)) as unknown as NextConfig;
