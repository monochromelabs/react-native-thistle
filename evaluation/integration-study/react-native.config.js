const provider = process.env.STUDY_PROVIDER;
if (!['thistle', 'llama'].includes(provider)) {
  throw new Error('Set STUDY_PROVIDER=thistle or STUDY_PROVIDER=llama');
}
module.exports = {
  dependencies: {
    'llama.rn':
      provider === 'thistle' ? { platforms: { ios: null, android: null } } : {},
    'react-native-thistle':
      provider === 'llama' ? { platforms: { ios: null, android: null } } : {},
    'react-native-nitro-modules':
      provider === 'llama' ? { platforms: { ios: null, android: null } } : {},
  },
};
