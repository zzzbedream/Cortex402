/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "d8j0ntlcm91z4.cloudfront.net" },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // stellar-sdk needs these Node.js polyfills in the browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
        http: false,
        https: false,
        url: false,
        os: false,
        path: false,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        events: false,
        util: false,
        assert: false,
        zlib: false,
        querystring: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
