import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const branch = 'feat/runtime-bridge-auto-ensure';

function runGit(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

async function replaceOnce(path, before, after) {
  const content = await readFile(path, 'utf8');
  if (content.includes(after)) {
    return false;
  }
  if (!content.includes(before)) {
    throw new Error(`Could not locate expected text in ${path}`);
  }
  await writeFile(path, content.replace(before, after));
  return true;
}

runGit(['fetch', 'origin', branch]);
runGit(['checkout', '-B', branch, `origin/${branch}`]);

let changed = false;

changed = (await replaceOnce(
  'src/tool-handlers.ts',
  `      const shouldStartRuntimeControl = args.runtimeControl === true;\n      let bridgeEnsureAction: 'installed' | 'updated' | 'unchanged' | null = null;\n\n      // Prepare the bridge BEFORE killing the existing process so a failed\n      // install/update does not leave the user without a running game.\n      if (shouldStartRuntimeControl) {\n        const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath);\n        bridgeEnsureAction = bridgeResult.action;\n      }`,
  `      const shouldStartRuntimeControl = args.runtimeControl === true;\n      let runtimeMessage = '';\n\n      // Prepare the bridge BEFORE killing the existing process so a failed\n      // install/update does not leave the user without a running game.\n      if (shouldStartRuntimeControl) {\n        try {\n          const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath);\n          runtimeMessage = bridgeResult.action === 'unchanged'\n            ? ' Runtime control enabled; bridge unchanged.'\n            : \` Runtime control enabled; bridge \${bridgeResult.action} (addons/godot_mcp_runtime/runtime_bridge.gd; project.godot [autoload]).\`;\n        } catch (error: unknown) {\n          const errorMessage = error instanceof Error ? error.message : 'Unknown error';\n          return this.createErrorResponse(\n            \`Failed to prepare runtime bridge: \${errorMessage}\`,\n            [\n              'Ensure the project directory and project.godot are writable',\n              'Use ensure_runtime_bridge to repair or inspect the managed bridge before launching with runtime control',\n            ]\n          );\n        }\n      }`
)) || changed;

changed = (await replaceOnce(
  'src/tool-handlers.ts',
  `      const runtimeMessage = shouldStartRuntimeControl\n        ? \` Runtime control enabled; bridge \${bridgeEnsureAction}.\`\n        : '';\n\n`,
  ``
)) || changed;

changed = (await replaceOnce(
  'src/runtime-control-manager.ts',
  `  async ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult> {\n    const currentStatus = await this.getBridgeStatus(projectPath);\n    if (currentStatus.installed && currentStatus.compatible) {\n      return { ...currentStatus, action: 'unchanged' };\n    }\n\n    const action = currentStatus.installed ? 'updated' : 'installed';\n    const status = await this.writeBridge(projectPath);\n\n    if (!status.installed || !status.compatible) {\n      throw new Error('Runtime bridge preparation did not produce a compatible managed bridge.');\n    }\n\n    return { ...status, action };\n  }`,
  `  async ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult> {\n    const currentStatus = await this.getBridgeStatus(projectPath);\n    if (currentStatus.installed && currentStatus.compatible && currentStatus.version) {\n      return {\n        installed: true,\n        version: currentStatus.version,\n        compatible: true,\n        action: 'unchanged',\n      };\n    }\n\n    const action = currentStatus.installed ? 'updated' : 'installed';\n    const status = await this.writeBridge(projectPath);\n\n    if (!status.installed || !status.compatible || !status.version) {\n      throw new Error('Runtime bridge preparation did not produce a compatible managed bridge.');\n    }\n\n    return {\n      installed: true,\n      version: status.version,\n      compatible: true,\n      action,\n    };\n  }`
)) || changed;

changed = (await replaceOnce(
  'src/runtime-control-manager.ts',
  `    const [installedScript, managedScript] = await Promise.all([\n      readFile(scriptPath, 'utf8'),\n      readFile(this.runtimeBridgeScriptPath, 'utf8'),\n    ]);\n\n    return {\n      installed: true,\n      version,\n      compatible:\n        version === this.getGeneratedBridgeVersion() && installedScript === managedScript,\n    };`,
  `    const [installedScript, managedScript] = await Promise.all([\n      readFile(scriptPath, 'utf8'),\n      this.readManagedBridgeScript(),\n    ]);\n\n    return {\n      installed: true,\n      version,\n      compatible:\n        version === this.getGeneratedBridgeVersion() &&\n        this.normalizeBridgeScript(installedScript) === this.normalizeBridgeScript(managedScript),\n    };`
)) || changed;

changed = (await replaceOnce(
  'src/runtime-control-manager.ts',
  `  private async pathExists(targetPath: string): Promise<boolean> {`,
  `  private async readManagedBridgeScript(): Promise<string> {\n    try {\n      return await readFile(this.runtimeBridgeScriptPath, 'utf8');\n    } catch (error: unknown) {\n      if (\n        error &&\n        typeof error === 'object' &&\n        'code' in error &&\n        (error as NodeJS.ErrnoException).code === 'ENOENT'\n      ) {\n        throw new Error(\`Generated runtime bridge script is missing: \${this.runtimeBridgeScriptPath}\`);\n      }\n      throw error;\n    }\n  }\n\n  private normalizeBridgeScript(content: string): string {\n    return content.replace(/\\r\\n?/g, '\\n');\n  }\n\n  private async pathExists(targetPath: string): Promise<boolean> {`
)) || changed;

changed = (await replaceOnce(
  'src/types.ts',
  `export interface RuntimeBridgeEnsureResult extends RuntimeBridgeStatus {\n  action: RuntimeBridgeEnsureAction;\n}`,
  `export interface RuntimeBridgeEnsureResult {\n  installed: true;\n  version: string;\n  compatible: true;\n  action: RuntimeBridgeEnsureAction;\n}`
)) || changed;

changed = (await replaceOnce(
  'docs/superpowers/specs/2026-08-21-runtime-screenshot-capture-design.md',
  `- **bridge version mismatch**\n  - instruct the user to run \`update_runtime_bridge\``,
  `- **bridge version mismatch**\n  - rerun with runtime control so the managed bridge is auto-repaired, or call \`ensure_runtime_bridge\` directly`
)) || changed;

changed = (await replaceOnce(
  'docs/superpowers/specs/2026-08-21-runtime-screenshot-capture-design.md',
  `Existing bridge compatibility checks therefore direct users with an older installed addon to \`update_runtime_bridge\` before runtime control starts.`,
  `Controlled launches reconcile the managed addon before runtime control starts; \`ensure_runtime_bridge\` provides the same repair path explicitly.`
)) || changed;

const packagePath = 'package.json';
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageJson.scripts.prepare !== 'npm run build') {
  packageJson.scripts.prepare = 'npm run build';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  changed = true;
}

await rm('scripts/apply-runtime-review-fixes.mjs', { force: true });

runGit(['add', 'src/tool-handlers.ts', 'src/runtime-control-manager.ts', 'src/types.ts', 'docs/superpowers/specs/2026-08-21-runtime-screenshot-capture-design.md', 'package.json', 'scripts/apply-runtime-review-fixes.mjs']);

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.trim()) {
  runGit(['commit', '-m', 'fix: address runtime bridge review feedback']);
  runGit(['push', 'origin', `HEAD:${branch}`]);
} else if (changed) {
  throw new Error('Expected staged changes after applying runtime review fixes.');
}
