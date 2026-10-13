import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep the app server-renderable; do not enable static export for app features.
};

export default nextConfig;
