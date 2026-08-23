import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

async function replaceExact(path, before, after, expectedCount = 1) {
  const content = await readFile(path, 'utf8');
  if (content.includes(after)) return false;
  const count = content.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} occurrence(s) in ${path}, found ${count}`);
  }
  await writeFile(path, content.replaceAll(before, after));
  return true;
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);

let changed = false;

changed = (await replaceExact(
  'src/types.ts',
  `export type RuntimeBridgeEnsureAction = 'installed' | 'updated' | 'unchanged';\n\nexport interface RuntimeBridgeEnsureResult {\n  installed: true;\n  version: string;\n  compatible: true;\n  action: RuntimeBridgeEnsureAction;\n}\n\nexport interface RuntimeBridgeManager extends RuntimeControlSessionManager {\n  ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult>;`,
  `export type RuntimeBridgeEnsureAction = 'installed' | 'updated' | 'unchanged';\n\nexport interface RuntimeBridgeEnsureOptions {\n  allowActiveSessionMutation?: boolean;\n}\n\nexport interface RuntimeBridgeEnsureResult {\n  version: string;\n  action: RuntimeBridgeEnsureAction;\n}\n\nexport interface RuntimeBridgeManager extends RuntimeControlSessionManager {\n  ensureBridge(projectPath: string, options?: RuntimeBridgeEnsureOptions): Promise<RuntimeBridgeEnsureResult>;`
)) || changed;

changed = (await replaceExact(
  'src/runtime-control-manager.ts',
  `  RuntimeBridgeEnsureResult,\n  RuntimeBridgeStatus,`,
  `  RuntimeBridgeEnsureOptions,\n  RuntimeBridgeEnsureResult,\n  RuntimeBridgeStatus,`
)) || changed;

changed = (await replaceExact(
  'src/runtime-control-manager.ts',
  `  async ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult> {\n    this.getGeneratedBridgeVersion();\n    const currentStatus = await this.getBridgeStatus(projectPath);\n    if (currentStatus.installed && currentStatus.compatible && currentStatus.version) {\n      return {\n        installed: true,\n        version: currentStatus.version,\n        compatible: true,\n        action: 'unchanged',\n      };\n    }\n\n    const action = currentStatus.installed ? 'updated' : 'installed';\n    const status = await this.writeBridge(projectPath);\n\n    if (!status.installed || !status.compatible || !status.version) {\n      throw new Error('Runtime bridge preparation did not produce a compatible managed bridge.');\n    }\n\n    return {\n      installed: true,\n      version: status.version,\n      compatible: true,\n      action,\n    };\n  }`,
  `  async ensureBridge(\n    projectPath: string,\n    options: RuntimeBridgeEnsureOptions = {}\n  ): Promise<RuntimeBridgeEnsureResult> {\n    const expectedVersion = this.getGeneratedBridgeVersion();\n    const currentStatus = await this.getBridgeStatus(projectPath);\n    if (currentStatus.installed && currentStatus.compatible && currentStatus.version) {\n      return { version: currentStatus.version, action: 'unchanged' };\n    }\n\n    const action = currentStatus.installed ? 'updated' : 'installed';\n\n    // Standalone maintenance must not rewrite files for the project that owns\n    // the live runtime session. Controlled restart explicitly opts in because\n    // run_project replaces that process immediately after successful preflight.\n    if (!options.allowActiveSessionMutation && this.activeSessionId) {\n      const normalizedPath = this.normalizeProjectPath(projectPath);\n      if (\n        !this.activeRuntimeSession ||\n        this.activeRuntimeSession.expectedProjectPath === normalizedPath\n      ) {\n        throw new Error('Cannot modify runtime bridge while a running session is active for this project.');\n      }\n    }\n\n    const status = await this.writeBridge(projectPath);\n\n    if (!status.installed || !status.compatible || !status.version) {\n      throw new Error(\n        \`Runtime bridge preparation did not produce a compatible managed bridge (installed=\${status.installed}, compatible=\${status.compatible}, version=\${status.version ?? 'null'}, expected=\${expectedVersion}, path=\${this.getBridgeTargetDir(projectPath)}).\`\n      );\n    }\n\n    return { version: status.version, action };\n  }`
)) || changed;

changed = (await replaceExact(
  'src/runtime-control-manager.ts',
  `    try {\n      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string };\n      version = manifest.version ?? null;\n    } catch {\n      return { installed: true, version: null, compatible: false };\n    }`,
  `    try {\n      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string };\n      version = manifest.version ?? null;\n    } catch (error: unknown) {\n      if (error instanceof SyntaxError) {\n        return { installed: true, version: null, compatible: false };\n      }\n      throw error;\n    }`
)) || changed;

changed = (await replaceExact(
  'src/tool-handlers.ts',
  `          const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath);`,
  `          const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath, {\n            allowActiveSessionMutation: true,\n          });`
)) || changed;

changed = (await replaceExact(
  'src/runtime-control-manager.spec.ts',
  `    const status = await manager.ensureBridge(projectPath);\n\n    expect(status.installed).toBe(true);\n    expect(status.version).toBe(bridgeVersion);`,
  `    const result = await manager.ensureBridge(projectPath);\n\n    expect(result).toEqual({ version: bridgeVersion, action: 'installed' });`
)) || changed;

changed = (await replaceExact(
  'src/runtime-control-manager.spec.ts',
  `    const status = await manager.ensureBridge(projectPath);\n\n    expect(status).toEqual(expect.objectContaining({\n      installed: true,\n      version: generatedVersion,\n      compatible: true,\n    }));`,
  `    const result = await manager.ensureBridge(projectPath);\n\n    expect(result).toEqual({ version: generatedVersion, action: 'updated' });`
)) || changed;

changed = (await replaceExact(
  'src/tool-handlers.runtime.spec.ts',
  `ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' })`,
  `ensureBridge: vi.fn().mockResolvedValue({ version: '1.0.0', action: 'unchanged' })`,
  4
)) || changed;

changed = (await replaceExact(
  'src/tool-handlers.runtime.spec.ts',
  `const ensureResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true,"action":"unchanged"}' }] };`,
  `const ensureResponse = { content: [{ type: 'text' as const, text: '{"version":"1.0.0","action":"unchanged"}' }] };`
)) || changed;

changed = (await replaceExact(
  'README.md',
  `The Codex wrapper uses \`@cwchanap/godot-plugin@0.1.4\`. Its \`npx\` launch path and marketplace installation are unavailable until that package is published to npm and the marketplace entry is enabled.`,
  `The Codex wrapper uses the exact \`@cwchanap/godot-plugin\` version pinned in \`plugins/godot-plugin/.mcp.json\`. Its \`npx\` launch path and marketplace installation are unavailable until that package is published to npm and the marketplace entry is enabled.`
)) || changed;

changed = (await replaceExact(
  'docs/superpowers/plans/2026-08-21-runtime-screenshot-capture.md',
  `and an older installed bridge requires \`update_runtime_bridge\`. Add \`capture_screenshot\` to the Cline \`autoApprove\` array.`,
  `and controlled launches automatically reconcile an older installed bridge before capture. Add \`capture_screenshot\` to the Cline \`autoApprove\` array.`
)) || changed;

changed = (await replaceExact(
  'docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md',
  `export interface RuntimeBridgeEnsureResult extends RuntimeBridgeStatus {\n  action: RuntimeBridgeEnsureAction;\n}`,
  `export interface RuntimeBridgeEnsureOptions {\n  allowActiveSessionMutation?: boolean;\n}\n\nexport interface RuntimeBridgeEnsureResult {\n  version: string;\n  action: RuntimeBridgeEnsureAction;\n}`,
  2
)) || changed;

changed = (await replaceExact(
  'docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md',
  `  ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult>;`,
  `  ensureBridge(projectPath: string, options?: RuntimeBridgeEnsureOptions): Promise<RuntimeBridgeEnsureResult>;`,
  2
)) || changed;

changed = (await replaceExact(
  'docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md',
  `The returned \`installed\`, \`version\`, and \`compatible\` fields must describe the **post-ensure** state, not the pre-ensure state.`,
  `The ensure result is intentionally minimal: \`{ action, version }\`. Successful ensure is the postcondition; callers that need variable \`installed\`/\`compatible\` state use \`get_runtime_bridge_status\`. Standalone ensure refuses same-project mutation while a runtime session is active; controlled restart passes \`allowActiveSessionMutation: true\` because it replaces that process immediately after successful preflight.`
)) || changed;

changed = (await replaceExact(
  'docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md',
  `  -> ensureBridge(projectPath)`,
  `  -> ensureBridge(projectPath, { allowActiveSessionMutation: true })`
)) || changed;

const planPath = 'docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md';
let plan = await readFile(planPath, 'utf8');
const fullResultPattern = /\n\s*installed: true,\n\s*version: bridgeVersion,\n\s*compatible: true,\n\s*action: 'installed',/g;
if (fullResultPattern.test(plan)) {
  plan = plan.replace(fullResultPattern, "\n    version: bridgeVersion,\n    action: 'installed',");
  await writeFile(planPath, plan);
  changed = true;
}

const packagePath = 'package.json';
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.scripts.prepare !== 'npm run build') {
  packageJson.scripts.prepare = 'npm run build';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  changed = true;
}

await rm('scripts/apply-review-comments.mjs', { force: true });

git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['add', '-A']);
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.trim()) {
  git(['commit', '-m', 'fix: address runtime bridge review comments']);
  git(['push', 'origin', `HEAD:${branch}`]);
} else if (changed) {
  throw new Error('Expected staged changes after applying review fixes.');
}
