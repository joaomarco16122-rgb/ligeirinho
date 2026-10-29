import type { NextConfig } from 'next';
import path from 'node:path';

const staticExport = process.env.LIGEIRINHO_WEB_OUTPUT === 'export';
const config: NextConfig = {
  poweredByHeader: false,
  ...(staticExport
    ? { output: 'export' as const, distDir: 'out', trailingSlash: true }
    : {
        output: 'standalone' as const,
        outputFileTracingRoot: path.resolve(__dirname, '../..'),
        async headers() {
          return [
            {
              source: '/(.*)',
              headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'X-Frame-Options', value: 'DENY' },
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(), microphone=(), geolocation=(self)',
                },
              ],
            },
          ];
        },
      }),
};
export default config;
