import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the user's home folder otherwise makes
  // Turbopack treat the whole home directory as the workspace root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
