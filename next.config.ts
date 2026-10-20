import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Every page here reads live data (database, cookies), so Cache Components stay off.
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
