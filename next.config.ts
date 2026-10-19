import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Shop banners and menu photos that owners upload live in Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
