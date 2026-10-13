import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://js.stripe.com\")" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@angelic/core", "@angelic/db"],
  serverExternalPackages: ["postgres", "exceljs"],
  typedRoutes: false,
  poweredByHeader: false,
  // Phone photos are several megabytes each and a visit can add a few at once; they are resized on the server.
  experimental: { serverActions: { bodySizeLimit: "40mb" } },
  async headers() {
    return [
      // Everything except the embeddable booking flow refuses to be framed.
      { source: "/((?!embed/).*)", headers: securityHeaders },
      // /embed/<slug> is meant for iframes on the business's own website (public/embed.js).
      { source: "/embed/:path*", headers: [...securityHeaders.filter((h) => h.key !== "X-Frame-Options"), { key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/embed.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=3600" }] },
    ];
  },
};

export default nextConfig;
