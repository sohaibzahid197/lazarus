const path = require('node:path');

const brainSrc = path.resolve(__dirname, '../../packages/brain/src');

module.exports = {
  preset: '@react-native/jest-preset',
  // Brain files live outside this app; Babel helpers they get
  // (`@babel/runtime/...`) resolve from the app's node_modules, like Metro's
  // `nodeModulesPaths`.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@lazarus/brain$': path.join(brainSrc, 'index.ts'),
    // Same file Metro picks through the `react-native` export condition.
    '^@lazarus/brain/gemini$': path.join(brainSrc, 'gemini.native.ts'),
    // Brain uses NodeNext-style `./x.js` specifiers for its `.ts` files.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // The preset's pattern, plus brain (if reached through node_modules) so
  // Babel transforms its TypeScript sources.
  // `__tests__/support` holds shared helpers (like the ports mock), not tests.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/support/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@lazarus/brain)/)',
  ],
};
