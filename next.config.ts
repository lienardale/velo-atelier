import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// `withContentCollections` is added by W1-T4 once `content-collections.ts` exists.
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
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
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
