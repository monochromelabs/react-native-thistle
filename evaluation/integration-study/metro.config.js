const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const thistleRoot = path.resolve(__dirname, '../..');
const provider = process.env.STUDY_PROVIDER;
if (!['thistle', 'llama'].includes(provider)) {
  throw new Error('Set STUDY_PROVIDER=thistle or STUDY_PROVIDER=llama');
}
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [thistleRoot],
  resolver: {
    disableHierarchicalLookup: true,
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    extraNodeModules: {
      'react': path.join(__dirname, 'node_modules/react'),
      'react-native': path.join(__dirname, 'node_modules/react-native'),
      'react-native-nitro-modules': path.join(
        __dirname,
        'node_modules/react-native-nitro-modules'
      ),
    },
    resolveRequest(context, name, platform) {
      if (name === 'study-provider') {
        return {
          type: 'sourceFile',
          filePath: path.join(__dirname, `src/${provider}.ts`),
        };
      }
      if (name === 'react-native-thistle') {
        return {
          type: 'sourceFile',
          filePath: path.join(thistleRoot, 'src/index.tsx'),
        };
      }
      return context.resolveRequest(context, name, platform);
    },
  },
});
