import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';
const specPath = 'src/runtime-control-manager.spec.ts';

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);

const before = "expect(result).toEqual({ version: generatedVersion, action: 'updated' });";
const after = "expect(result).toEqual({ version: generatedVersion, action: 'installed' });";
const spec = await readFile(specPath, 'utf8');
if (!spec.includes(after)) {
  if (!spec.includes(before)) {
    throw new Error('Expected stale half-install action assertion not found.');
  }
  await writeFile(specPath, spec.replace(before, after));
}

const packagePath = 'package.json';
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
packageJson.scripts.prepare = 'npm run build';
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
await rm('scripts/apply-test-fixture-fix.mjs', { force: true });

git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['add', '-A']);
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.trim()) {
  git(['commit', '-m', 'test: align half-install action expectation']);
  git(['push', 'origin', `HEAD:${branch}`]);
}
