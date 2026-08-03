import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) for a slim
  // runtime container image — see ui/Dockerfile.
  output: "standalone",
};

export default nextConfig;
