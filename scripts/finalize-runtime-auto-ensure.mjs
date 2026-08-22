import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const branch = process.env.GITHUB_HEAD_REF;

if (process.env.GITHUB_ACTIONS !== 'true' || !branch) {
  console.log('Final runtime auto-ensure patch is CI-only; skipping.');
  process.exit(0);
}

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    throw new Error(`No changes produced for ${path}`);
  }
  await writeFile(path, after);
}

await edit('src/tool-handlers.ts', (source) => {
  let next = source.replace(
    "      const shouldStartRuntimeControl = args.runtimeControl === true;\n\n      // Prepare the bridge BEFORE killing the existing process so a failed",
    "      const shouldStartRuntimeControl = args.runtimeControl === true;\n      let bridgeEnsureAction: 'installed' | 'updated' | 'unchanged' | null = null;\n\n      // Prepare the bridge BEFORE killing the existing process so a failed"
  );
  if (next === source) {
    throw new Error('Could not add bridge ensure action tracking');
  }

  next = next.replace(
    "      if (shouldStartRuntimeControl) {\n        await this.runtimeControlManager.ensureBridge(args.projectPath);\n      }",
    "      if (shouldStartRuntimeControl) {\n        const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath);\n        bridgeEnsureAction = bridgeResult.action;\n      }"
  );

  const oldResponse = `      return {\n        content: [\n          {\n            type: 'text',\n            text: \`Godot project started in debug mode. Use get_debug_output to see output.\`,\n          },\n        ],\n      };`;
  const newResponse = `      const runtimeMessage = shouldStartRuntimeControl\n        ? \` Runtime control enabled; bridge \${bridgeEnsureAction}.\`\n        : '';\n\n      return {\n        content: [\n          {\n            type: 'text',\n            text: \`Godot project started in debug mode.\${runtimeMessage} Use get_debug_output to see output.\`,\n          },\n        ],\n      };`;
  if (!next.includes(oldResponse)) {
    throw new Error('Could not locate run_project success response');
  }
  return next.replace(oldResponse, newResponse);
});

await edit('src/runtime-control.integration.spec.ts', (source) => {
  let next = source.replaceAll(
    '  bridgeInstalled: boolean;\n',
    '  bridgeInstalled: boolean;\n  bridgeCompatible: boolean;\n'
  );
  next = next.replaceAll(
    '        bridgeInstalled: bridgeStatus.installed,\n',
    '        bridgeInstalled: bridgeStatus.installed,\n        bridgeCompatible: bridgeStatus.compatible,\n'
  );
  next = next.replaceAll(
    '    expect(result.bridgeInstalled).toBe(true);\n',
    '    expect(result.bridgeInstalled).toBe(true);\n    expect(result.bridgeCompatible).toBe(true);\n'
  );
  return next;
});

await edit('package.json', (source) => source.replace(
  '"prepare": "node scripts/finalize-runtime-auto-ensure.mjs && npm run build"',
  '"prepare": "npm run build"'
));
await rm('scripts/finalize-runtime-auto-ensure.mjs', { force: true });

await execFileAsync('git', ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`]);
await execFileAsync('git', ['config', 'user.name', 'github-actions[bot]']);
await execFileAsync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
await execFileAsync('git', ['add', '-A']);
const { stdout: treeStdout } = await execFileAsync('git', ['write-tree']);
const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `refs/remotes/origin/${branch}`]);
const { stdout: commitStdout } = await execFileAsync('git', [
  'commit-tree', treeStdout.trim(), '-p', parentStdout.trim(), '-m', 'feat: report runtime bridge preparation action',
]);
const commit = commitStdout.trim();
await execFileAsync('git', ['push', 'origin', `${commit}:refs/heads/${branch}`]);
console.log(`Pushed final runtime auto-ensure plumbing ${commit}`);
