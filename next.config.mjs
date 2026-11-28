/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The link-preview poster reads its bundled fonts from disk.
    outputFileTracingIncludes: {
      "/opengraph-image": ["./app/og-fonts/**"],
    },
  },
};

export default nextConfig;
