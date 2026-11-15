const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const repoRoot = path.resolve(__dirname, '../..');
const brainRoot = path.join(repoRoot, 'packages/brain');
const brainSrc = path.join(brainRoot, 'src') + path.sep;

/**
 * Brain uses NodeNext-style `./x.js` specifiers for its `.ts` files. Map them
 * to the sibling `.ts` file, but only for imports made from inside
 * `packages/brain/src`, so node_modules resolution is unchanged.
 */
function resolveRequest(context, moduleName, platform) {
  const origin = safeRealpath(context.originModulePath);
  if (
    origin.startsWith(brainSrc) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    const tsName = moduleName.slice(0, -'.js'.length) + '.ts';
    if (fs.existsSync(path.resolve(path.dirname(origin), tsName))) {
      return context.resolveRequest(context, tsName, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
}

function safeRealpath(file) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return file;
  }
}

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [brainRoot],
  resolver: {
    nodeModulesPaths: [
      path.join(__dirname, 'node_modules'),
      path.join(repoRoot, 'node_modules'),
    ],
    // `@lazarus/brain/gemini` picks `gemini.native.ts` through the
    // `react-native` export condition.
    unstable_enablePackageExports: true,
    unstable_conditionNames: ['react-native'],
    resolveRequest,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
