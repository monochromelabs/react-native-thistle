const fs = require('fs');
const path = require('path');

const appRoot = process.env.INIT_CWD || process.cwd();
const packageFile = path.join(appRoot, 'package.json');

if (process.env.THISTLE_SKIP_ASSETS === '1' || !fs.existsSync(packageFile)) {
  process.exit(0);
}

const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));

if (packageJson.name === 'react-native-thistle') {
  process.exit(0);
}

fs.mkdirSync(path.join(appRoot, 'assets'), { recursive: true });
