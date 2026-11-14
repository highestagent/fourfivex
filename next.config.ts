import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: { NEXT_PUBLIC_MARKETS_SOCKET_ORIGIN: process.env.MARKETS_WORKER_ORIGIN ?? "" },
  // A passkey belongs to the hostname it was made on, and the Markets Worker accepts only
  // fourfivex.xyz. Send the default Vercel domain there so no account is made anywhere else.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "fourfivex.vercel.app" }],
        destination: "https://fourfivex.xyz/:path*",
        permanent: true,
      },
    ];
  },
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
