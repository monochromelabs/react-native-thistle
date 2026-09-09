#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appRoot = process.env.INIT_CWD || process.cwd();
const assetsDirectory = path.join(appRoot, 'assets');
const thistleDirectory = path.join(appRoot, '.thistle');
const selectionFile = path.join(thistleDirectory, 'models.json');
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

function getAssetModels() {
  return fs
    .readdirSync(assetsDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')
    )
    .map((entry) => entry.name)
    .sort();
}

function readSelectedModels(availableModels) {
  if (!fs.existsSync(selectionFile)) {
    return [];
  }

  const selection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  if (!Array.isArray(selection.models)) {
    throw new Error(
      `${path.relative(appRoot, selectionFile)} must contain a models array`
    );
  }
  return selection.models.filter((model) => availableModels.includes(model));
}

function writeSelectedModels(models) {
  fs.mkdirSync(thistleDirectory, { recursive: true });
  writeIfChanged(selectionFile, `${JSON.stringify({ models }, null, 2)}\n`);
}

function ask(question) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const prompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function selectModels(availableModels, selectedModels) {
  if (availableModels.length === 0) {
    return Promise.resolve([]);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'GGUF selection requires an interactive terminal. Run `npx react-native-thistle setup` directly.'
    );
  }

  const choices = [...availableModels, 'None'];
  const selected = new Set(selectedModels);
  let cursor = 0;

  return new Promise((resolve) => {
    const readline = require('readline');
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(
        'Select GGUF models to package (Space toggles, Enter saves):\n'
      );
      choices.forEach((choice, index) => {
        const marker =
          choice === 'None'
            ? selected.size === 0
              ? '[x]'
              : '[ ]'
            : selected.has(choice)
              ? '[x]'
              : '[ ]';
        const pointer = index === cursor ? '>' : ' ';
        console.log(`${pointer} ${marker} ${choice}`);
      });
      console.log('\nUse Up/Down arrows, Space, then Enter.');
    };

    const finish = (models) => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('keypress', onKeypress);
      process.stdout.write('\n');
      resolve(models);
    };

    const onKeypress = (input, key) => {
      if (key.name === 'up')
        cursor = (cursor + choices.length - 1) % choices.length;
      if (key.name === 'down') cursor = (cursor + 1) % choices.length;
      if (key.name === 'space') {
        const choice = choices[cursor];
        if (choice === 'None') selected.clear();
        else if (selected.has(choice)) selected.delete(choice);
        else selected.add(choice);
      }
      if (key.name === 'return') {
        if (selected.size === 0 && selectedModels.length > 0) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('keypress', onKeypress);
          ask('You are disconnecting all GGUFs. Continue? [y/N] ').then(
            (answer) => {
              process.stdin.setRawMode(true);
              process.stdin.on('keypress', onKeypress);
              if (answer !== 'y' && answer !== 'yes') {
                render();
                return;
              }
              finish(
                [...selected]
                  .filter((model) => availableModels.includes(model))
                  .sort()
              );
            }
          );
          return;
        }
        finish(
          [...selected]
            .filter((model) => availableModels.includes(model))
            .sort()
        );
        return;
      }
      if (key.ctrl && key.name === 'c') finish(selectedModels);
      else render();
    };

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

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

for model_name in MODEL_NAMES
do
  for model_directory in "\${THISTLE_MODEL_DIR:-}" "$SRCROOT/../assets" "$SRCROOT/../../assets"
  do
    model_path="$model_directory/$model_name"
    if [ -f "$model_path" ]; then
      cp -f "$model_path" "$destination/"
      break
    fi
  done
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

function androidAssetsBlock(models, isKotlin) {
  const modelCopies = models
    .map((model) => {
      const source = JSON.stringify(`../../assets/${model}`);
      return isKotlin
        ? `        from(${source})`
        : `        from(file(${source}))`;
    })
    .join('\n');

  if (isKotlin) {
    return `${androidGroovyMarker}
    val thistleModelAssetsDir = layout.buildDirectory.dir("generated/thistle/assets")
    tasks.register<Sync>("copyThistleModelAssets") {
      into(thistleModelAssetsDir)
${modelCopies || '        // No GGUF models are currently connected.'}
    }
    tasks.named("preBuild").configure { dependsOn("copyThistleModelAssets") }
    sourceSets["main"].assets.srcDir(thistleModelAssetsDir)
    // END THISTLE MODEL ASSETS`;
  }

  return `${androidGroovyMarker}
    def thistleModelAssetsDir = file("$buildDir/generated/thistle/assets")
    tasks.register("copyThistleModelAssets", Sync) {
        into(thistleModelAssetsDir)
${modelCopies || '        // No GGUF models are currently connected.'}
    }
    tasks.named("preBuild").configure { dependsOn("copyThistleModelAssets") }
    sourceSets {
        main {
            assets.srcDir(thistleModelAssetsDir)
        }
    }
    // END THISTLE MODEL ASSETS`;
}

function setupAndroid(models) {
  const filePath = fs.existsSync(androidGradle)
    ? androidGradle
    : androidGradleKts;
  if (!fs.existsSync(filePath)) {
    return 'Android project not found';
  }

  let contents = fs.readFileSync(filePath, 'utf8');
  const block = `${androidAssetsBlock(models, filePath.endsWith('.kts'))}\n`;
  const androidBlock = /android\s*\{/.exec(contents);
  if (!androidBlock) {
    throw new Error(`Could not find the android block in ${filePath}`);
  }

  if (contents.includes(androidGroovyMarker)) {
    const markerBlock = new RegExp(
      `${androidGroovyMarker}[\\s\\S]*?// END THISTLE MODEL ASSETS\\n?`
    );
    contents = contents.replace(markerBlock, block);
  } else {
    const insertAt = androidBlock.index + androidBlock[0].length;
    contents = `${contents.slice(0, insertAt)}\n${block}${contents.slice(insertAt)}`;
  }
  fs.writeFileSync(filePath, contents);
  return `Configured ${path.relative(appRoot, filePath)} for ${models.length} GGUF model${models.length === 1 ? '' : 's'}`;
}

function setupIos(models) {
  if (!fs.existsSync(podfile)) {
    return 'iOS Podfile not found';
  }

  const modelNames = models.length
    ? models.map((model) => JSON.stringify(model)).join(' ')
    : '""';
  const scriptChanged = writeIfChanged(
    iosScript,
    iosScriptContents.replace('MODEL_NAMES', modelNames),
    0o755
  );
  let contents = fs.readFileSync(podfile, 'utf8');
  if (contents.includes(iosMarker)) {
    return scriptChanged
      ? `Updated iOS model-copy script for ${models.length} GGUF model${models.length === 1 ? '' : 's'}`
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
  return `Configured iOS model-copy build phase for ${models.length} GGUF model${models.length === 1 ? '' : 's'}`;
}

function main() {
  fs.mkdirSync(assetsDirectory, { recursive: true });
  const availableModels = getAssetModels();
  const configuredModels = readSelectedModels(availableModels);
  return selectModels(availableModels, configuredModels).then(
    (selectedModels) => {
      writeSelectedModels(selectedModels);
      console.log(
        `Created or verified ${path.relative(appRoot, assetsDirectory)}/`
      );
      console.log(
        selectedModels.length === 0
          ? 'No GGUF models are connected.'
          : `Connected GGUF models: ${selectedModels.join(', ')}`
      );
      console.log(setupAndroid(selectedModels));
      console.log(setupIos(selectedModels));
      console.log(
        '\nRun pod install and rebuild the app after changing model selections.'
      );
    }
  );
}

main().catch((error) => {
  console.error(`react-native-thistle setup failed: ${error.message}`);
  process.exitCode = 1;
});
