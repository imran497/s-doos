import type { NextConfig } from "next";

// Sent with every response. Search engines may index only the privacy notice.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // A self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  // better-sqlite3 is a native module: load it from node_modules instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/((?!privacy$).*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
