import type { NextConfig } from 'next';

// The brain is consumed as TypeScript source with `.js` import suffixes, so
// webpack must try `.ts` for a `.js` import (design C9). No `env` key and no
// NEXT_PUBLIC_ variable: nothing from the environment reaches the browser.
const config: NextConfig = {
  transpilePackages: ['@lazarus/brain'],
  poweredByHeader: false,
  webpack(cfg: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.js'] };
    return cfg;
  },
};

export default config;
