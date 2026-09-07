#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appRoot = process.env.INIT_CWD || process.cwd();
const assetsDirectory = path.join(appRoot, 'assets');
const androidGradle = path.join(appRoot, 'android', 'app', 'build.gradle');
const androidGradleKts = path.join(
  appRoot,
  'android',
  'app',
  'build.gradle.kts'
);
const podfile = path.join(appRoot, 'ios', 'Podfile');
const iosScript = path.join(appRoot, 'ios', 'ThistleModelAssets.sh');

const androidGroovyMarker = '// BEGIN THISTLE MODEL ASSETS';
const iosMarker = '# BEGIN THISTLE MODEL ASSETS';

const iosHelper = `
# BEGIN THISTLE MODEL ASSETS

def thistle_add_model_assets_build_phase(installer)
  installer.aggregate_targets.each do |aggregate_target|
    aggregate_target.user_project.native_targets.each do |native_target|
      next unless native_target.product_type == 'com.apple.product-type.application'

      phase = native_target.shell_script_build_phases.find {
        |existing_phase| existing_phase.name == 'Thistle GGUF models'
      }
      phase ||= native_target.new_shell_script_build_phase('Thistle GGUF models')
      phase.shell_script = File.read(
        File.join(Pod::Config.instance.installation_root, 'ThistleModelAssets.sh')
      )
    end
  end
end

# END THISTLE MODEL ASSETS
`;

const iosScriptContents = `#!/bin/sh
set -eu

destination="\${TARGET_BUILD_DIR}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
mkdir -p "$destination"
find "$destination" -type f -name '*.gguf' -delete

for model_directory in \
  "\${THISTLE_MODEL_DIR:-}" \\
  "$SRCROOT/../assets" \
  "$SRCROOT/../../assets" \
do
  if [ -d "$model_directory" ]; then
    find "$model_directory" -type f -name '*.gguf' -exec cp -f {} "$destination/" \\\;
  fi
done
`;

function writeIfChanged(filePath, contents, mode) {
  if (
    fs.existsSync(filePath) &&
    fs.readFileSync(filePath, 'utf8') === contents
  ) {
    return false;
  }
  fs.writeFileSync(filePath, contents);
  if (mode) {
    fs.chmodSync(filePath, mode);
  }
  return true;
}

function setupAndroid() {
  const filePath = fs.existsSync(androidGradle)
    ? androidGradle
    : androidGradleKts;
  if (!fs.existsSync(filePath)) {
    return 'Android project not found';
  }

  let contents = fs.readFileSync(filePath, 'utf8');
  if (contents.includes(androidGroovyMarker)) {
    return 'Android assets already configured';
  }

  const block = filePath.endsWith('.kts')
    ? `    ${androidGroovyMarker}\n    sourceSets["main"].assets.srcDir("../../assets")\n    // END THISTLE MODEL ASSETS\n`
    : `    ${androidGroovyMarker}\n    sourceSets {\n        main {\n            assets.srcDir(file("../../assets"))\n        }\n    }\n    // END THISTLE MODEL ASSETS\n`;
  const androidBlock = /android\s*\{/.exec(contents);
  if (!androidBlock) {
    throw new Error(`Could not find the android block in ${filePath}`);
  }

  const insertAt = androidBlock.index + androidBlock[0].length;
  contents = `${contents.slice(0, insertAt)}\n${block}${contents.slice(insertAt)}`;
  fs.writeFileSync(filePath, contents);
  return `Configured ${path.relative(appRoot, filePath)}`;
}

function setupIos() {
  if (!fs.existsSync(podfile)) {
    return 'iOS Podfile not found';
  }

  const scriptChanged = writeIfChanged(iosScript, iosScriptContents, 0o755);
  let contents = fs.readFileSync(podfile, 'utf8');
  if (contents.includes(iosMarker)) {
    return scriptChanged
      ? 'Updated iOS model-copy script'
      : 'iOS assets already configured';
  }

  contents = `${iosHelper.trim()}\n\n${contents}`;
  const postInstall = /post_install\s+do\s*\|installer\|/;
  if (postInstall.test(contents)) {
    contents = contents.replace(
      postInstall,
      (match) => `${match}\n    thistle_add_model_assets_build_phase(installer)`
    );
  } else {
    contents += `\npost_install do |installer|\n  thistle_add_model_assets_build_phase(installer)\nend\n`;
  }
  fs.writeFileSync(podfile, contents);
  return 'Configured iOS model-copy build phase';
}

function main() {
  fs.mkdirSync(assetsDirectory, { recursive: true });
  console.log(
    `Created or verified ${path.relative(appRoot, assetsDirectory)}/`
  );
  console.log(setupAndroid());
  console.log(setupIos());
  console.log(
    '\nAdd a .gguf file to assets/, run pod install, and rebuild the app.'
  );
}

try {
  main();
} catch (error) {
  console.error(`react-native-thistle setup failed: ${error.message}`);
  process.exitCode = 1;
}
