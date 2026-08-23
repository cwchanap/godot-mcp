import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';
const path = 'src/tool-handlers.ts';
const stale = `      const runtimeMessage = shouldStartRuntimeControl\n        ? \` Runtime control enabled; bridge \${bridgeEnsureAction}.\`\n        : '';\n\n`;

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);
git(['config', 'user.name', 'cwchanap']);
git(['config', 'user.email', '29033105+cwchanap@users.noreply.github.com']);

let content = await readFile(path, 'utf8');
if (content.includes(stale)) {
  content = content.replace(stale, '');
  await writeFile(path, content);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
packageJson.scripts.prepare = 'npm run build';
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
await rm('scripts/remove-stale-runtime-message.mjs', { force: true });

git(['add', path, 'package.json', 'scripts/remove-stale-runtime-message.mjs']);
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.trim()) {
  git(['commit', '-m', 'fix: remove stale runtime launch message']);
  git(['push', 'origin', `HEAD:${branch}`]);
}
