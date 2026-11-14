import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: { NEXT_PUBLIC_MARKETS_SOCKET_ORIGIN: process.env.MARKETS_WORKER_ORIGIN ?? "" },
  async rewrites() {
    const origin = process.env.MARKETS_WORKER_ORIGIN ??
      (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8787" : undefined);
    return origin
      ? [{ source: "/api/markets/:path*", destination: new URL("/api/markets/:path*", origin).href }]
      : [];
  },
  turbopack: {
    rules: {
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
