import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@angelic/core", "@angelic/db"],
  serverExternalPackages: ["postgres"],
  typedRoutes: false,
};

export default nextConfig;
