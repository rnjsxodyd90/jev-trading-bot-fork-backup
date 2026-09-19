import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Run dashboard commands from web/; avoid __dirname in this ES module.
  turbopack: { root: process.cwd() },
};
export default nextConfig;
