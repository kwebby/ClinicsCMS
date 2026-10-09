/* Author: ramanpal singh | URL: https://kwebby.com */
import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone', poweredByHeader: false, devIndicators: false, agentRules: false,
  webpack(config) { config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] }; return config; },
  async rewrites() {
    const backend = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }, { source: '/socket.io/:path*', destination: `${backend}/socket.io/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'}]}, ...['/workspace/:path*','/portal/:path*','/login','/register','/setup'].map(source=>({source,headers:[{key:'Cache-Control',value:'private, no-store, max-age=0'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}))];
  }
};
export default config;
