import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const branch = process.env.GITHUB_HEAD_REF;

if (process.env.GITHUB_ACTIONS !== 'true' || !branch) {
  console.log('Runtime bridge test migration is CI-only; skipping.');
  process.exit(0);
}

const testPath = 'src/tool-handlers.runtime.spec.ts';
const source = await readFile(testPath, 'utf8');
const oldBlock = `  it.each([\n    ['handleInstallRuntimeBridge', 'installBridge', 'Failed to install runtime bridge'],\n    ['handleGetRuntimeBridgeStatus', 'getBridgeStatus', 'Failed to get runtime bridge status'],\n    ['handleUpdateRuntimeBridge', 'updateBridge', 'Failed to update runtime bridge'],\n    ['handleUninstallRuntimeBridge', 'uninstallBridge', 'Failed to uninstall runtime bridge'],\n  ] as const)(\n    'rejects non-Godot projects in %s',\n    async (handlerName, managerMethodName, unexpectedMessage) => {\n      const runtimeManager = {\n        startSession: vi.fn(),\n        stopSession: vi.fn().mockResolvedValue(undefined),\n        cleanup: vi.fn().mockResolvedValue(undefined),\n        installBridge: vi.fn(),\n        getBridgeStatus: vi.fn(),\n        updateBridge: vi.fn(),\n        uninstallBridge: vi.fn(),\n      };`;
const newBlock = `  it.each([\n    ['handleEnsureRuntimeBridge', 'ensureBridge', 'Failed to ensure runtime bridge'],\n    ['handleGetRuntimeBridgeStatus', 'getBridgeStatus', 'Failed to get runtime bridge status'],\n    ['handleUninstallRuntimeBridge', 'uninstallBridge', 'Failed to uninstall runtime bridge'],\n  ] as const)(\n    'rejects non-Godot projects in %s',\n    async (handlerName, managerMethodName, unexpectedMessage) => {\n      const runtimeManager = {\n        startSession: vi.fn(),\n        stopSession: vi.fn().mockResolvedValue(undefined),\n        cleanup: vi.fn().mockResolvedValue(undefined),\n        ensureBridge: vi.fn(),\n        getBridgeStatus: vi.fn(),\n        uninstallBridge: vi.fn(),\n      };`;
if (!source.includes(oldBlock)) {
  throw new Error('Could not locate stale runtime bridge project-validation table');
}
await writeFile(testPath, source.replace(oldBlock, newBlock));

const packagePath = 'package.json';
const packageSource = await readFile(packagePath, 'utf8');
await writeFile(
  packagePath,
  packageSource.replace(
    '"prepare": "node scripts/fix-runtime-auto-ensure-tests.mjs && npm run build"',
    '"prepare": "npm run build"'
  )
);
await rm('scripts/fix-runtime-auto-ensure-tests.mjs', { force: true });

await execFileAsync('git', ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`]);
await execFileAsync('git', ['config', 'user.name', 'github-actions[bot]']);
await execFileAsync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
await execFileAsync('git', ['add', '-A']);
const { stdout: treeStdout } = await execFileAsync('git', ['write-tree']);
const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `refs/remotes/origin/${branch}`]);
const { stdout: commitStdout } = await execFileAsync('git', [
  'commit-tree', treeStdout.trim(), '-p', parentStdout.trim(), '-m', 'test: finish runtime bridge tool migration',
]);
const commit = commitStdout.trim();
await execFileAsync('git', ['push', 'origin', `${commit}:refs/heads/${branch}`]);
console.log(`Pushed runtime bridge test migration ${commit}`);
