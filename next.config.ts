import type { NextConfig } from "next";

// Menu photos come only from this project's storage. A wildcard would let anyone use the image optimizer
// (billed per image) as a free resizer for any Supabase project's files.
const storageHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "*.supabase.co";
  }
})();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Browser-side protections for every page. The Content-Security-Policy holds only rules that cannot
        // break scripts or payments: no framing by other sites, no injected <base>, no plugins. A strict
        // script policy needs a nonce for Next's inline scripts and a test pass against Cashfree's checkout.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(self), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Browsers must always fetch the newest service worker, or an update could never reach anyone.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  images: {
    // Shop banners and menu photos that owners upload live in Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: storageHost, pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
