import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return ["/infoOwner/:path*", "/email/unsubscribe/:path*", "/api/v1/email-unsubscribe/:path*"].map(source => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "private, no-store" },
    ] }));
  },
  serverExternalPackages: ["pdfkit", "fontkit"],
  outputFileTracingIncludes: { "/api/v1/**": ["./assets/fonts/*"] },
};

export default nextConfig;
