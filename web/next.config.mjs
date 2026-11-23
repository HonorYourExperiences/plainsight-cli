import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
export default {
  // the analyzer (and its TypeScript compiler) runs as plain Node code, not bundled
  serverExternalPackages: ["plainsight-cli", "typescript", "elkjs", "pg"],
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    }];
  },
};
