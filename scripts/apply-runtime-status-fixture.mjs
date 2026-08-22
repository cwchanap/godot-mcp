import { readFile, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';
const scriptPath = 'scripts/apply-runtime-status-fixture.mjs';

function git(args, options = {}) {
  return execFileSync('git', args, { stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);

const specPath = 'src/runtime-control-manager.spec.ts';
const before = await readFile(specPath, 'utf8');
const oldLine = "    await writeFile(path.join(bridgeDir, 'runtime_bridge.gd'), await readFile(sourceBridgeScriptPath, 'utf8'));";
const newLine = "    await writeFile(path.join(bridgeDir, 'runtime_bridge.gd'), await readFile(path.join(generatedAssetsPath, 'runtime_bridge.gd'), 'utf8'));";

if (before.includes(oldLine)) {
  await writeFile(specPath, before.replace(oldLine, newLine));
} else if (!before.includes(newLine)) {
  throw new Error('Could not locate runtime bridge status fixture line.');
}

const packagePath = 'package.json';
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.scripts.prepare !== 'npm run build') {
  packageJson.scripts.prepare = 'npm run build';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

await unlink(scriptPath).catch(() => undefined);

const status = git(['status', '--porcelain'], { capture: true }).trim();
if (status) {
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['add', '-A']);
  git(['commit', '-m', 'test: use generated runtime bridge in status fixture']);
  git(['push', 'origin', branch]);
}
