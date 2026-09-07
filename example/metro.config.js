const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('gguf');
config.resolver.blockList = [/\.gguf$/];

module.exports = withMetroConfig(config, {
  root,
  dirname: __dirname,
  conditions: ['react-native-thistle-source'],
});
