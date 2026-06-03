import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LAN IPs allowed to hit the dev server. Next.js 16 blocks cross-origin
  // dev requests by default — list every device IP that needs to load the
  // POS over the local network here.
  allowedDevOrigins: ["10.0.21.124", "10.0.21.164", "10.0.40.9"],
};

export default nextConfig;
