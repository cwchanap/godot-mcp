import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildScriptsDir = path.join(__dirname, '..', 'build', 'scripts');
const packageVersion = fs.readJsonSync(path.join(__dirname, '..', 'package.json')).version;

fs.chmodSync(path.join(__dirname, '..', 'build', 'index.js'), '755');

try {
  fs.ensureDirSync(buildScriptsDir);

  const scriptsToCopy = ['godot_operations.gd', 'editor_reimport.gd'];

  for (const scriptName of scriptsToCopy) {
    fs.copyFileSync(
      path.join(__dirname, '..', 'src', 'scripts', scriptName),
      path.join(buildScriptsDir, scriptName)
    );
  }

  const runtimeBridgeScriptTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'runtime_bridge.gd'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(buildScriptsDir, 'runtime_bridge.gd'),
    runtimeBridgeScriptTemplate.replaceAll('__PACKAGE_VERSION__', packageVersion)
  );

  const runtimeBridgeManifestTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'runtime_bridge_manifest.json'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(buildScriptsDir, 'runtime_bridge_manifest.json'),
    runtimeBridgeManifestTemplate.replaceAll('__PACKAGE_VERSION__', packageVersion)
  );

  console.log('Successfully copied Godot scripts to build/scripts');
} catch (error) {
  console.error('Error copying scripts:', error);
  process.exit(1);
}
