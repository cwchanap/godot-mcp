import { readFile, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';
const scriptPath = 'scripts/apply-coderabbit-bridge-script-validation.mjs';

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);

const managerPath = 'src/runtime-control-manager.ts';
const managerBefore = await readFile(managerPath, 'utf8');
const oldStatusReturn = `    return {\n      installed: true,\n      version,\n      compatible: version === this.getGeneratedBridgeVersion(),\n    };\n`;
const newStatusReturn = `    const [installedScript, managedScript] = await Promise.all([\n      readFile(scriptPath, 'utf8'),\n      readFile(this.runtimeBridgeScriptPath, 'utf8'),\n    ]);\n\n    return {\n      installed: true,\n      version,\n      compatible:\n        version === this.getGeneratedBridgeVersion() && installedScript === managedScript,\n    };\n`;

if (!managerBefore.includes(oldStatusReturn)) {
  throw new Error('Could not locate runtime bridge compatibility return block.');
}
await writeFile(managerPath, managerBefore.replace(oldStatusReturn, newStatusReturn));

const packagePath = 'package.json';
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
packageJson.scripts.prepare = 'npm run build';
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

await unlink(scriptPath);

git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['add', '-A']);
git(['commit', '-m', 'fix: validate installed runtime bridge script']);
git(['push', 'origin', branch]);
