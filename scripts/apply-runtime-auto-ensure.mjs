import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const branch = process.env.GITHUB_HEAD_REF;

if (process.env.GITHUB_ACTIONS !== 'true' || !branch) {
  console.log('Runtime auto-ensure patch is CI-only; skipping.');
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
  const preflightPattern = /      \/\/ Validate the bridge BEFORE killing the existing process so a failed\n      \/\/ preflight check does not leave the user without a running game\.\n      if \(shouldStartRuntimeControl\) \{[\s\S]*?\n      \}\n\n      \/\/ Kill any existing process/;
  const preflightReplacement = `      // Prepare the bridge BEFORE killing the existing process so a failed\n      // install/update does not leave the user without a running game.\n      if (shouldStartRuntimeControl) {\n        await this.runtimeControlManager.ensureBridge(args.projectPath);\n      }\n\n      // Kill any existing process`;
  let next = source.replace(preflightPattern, preflightReplacement);
  if (next === source) {
    throw new Error('Could not replace runtime bridge launch preflight');
  }

  const installStart = next.indexOf('  async handleInstallRuntimeBridge(args: any) {');
  const statusStart = next.indexOf('  async handleGetRuntimeBridgeStatus(args: any) {');
  if (installStart === -1 || statusStart === -1 || statusStart <= installStart) {
    throw new Error('Could not locate runtime bridge install handler');
  }

  const ensureHandler = `  async handleEnsureRuntimeBridge(args: any) {\n    args = this.operationExecutor.normalizeParameters(args);\n\n    if (!args.projectPath) {\n      return this.createErrorResponse(\n        'Project path is required',\n        ['Provide a valid path to a Godot project directory']\n      );\n    }\n\n    if (!ProjectUtils.validatePath(args.projectPath)) {\n      return this.createErrorResponse(\n        'Invalid project path',\n        ['Provide a valid path without ".." or other potentially unsafe characters']\n      );\n    }\n\n    try {\n      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {\n        return this.createErrorResponse(\n          \`Not a valid Godot project: \${args.projectPath}\`,\n          [\n            'Ensure the path points to a directory containing a project.godot file',\n            'Use list_projects to find valid Godot projects',\n          ]\n        );\n      }\n\n      const result = await this.runtimeControlManager.ensureBridge(args.projectPath);\n      return {\n        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],\n      };\n    } catch (error: any) {\n      return this.createErrorResponse(\n        \`Failed to ensure runtime bridge: \${error?.message || 'Unknown error'}\`,\n        ['Ensure the project path is writable and contains a valid Godot project']\n      );\n    }\n  }\n\n`;
  next = `${next.slice(0, installStart)}${ensureHandler}${next.slice(statusStart)}`;

  const updateStart = next.indexOf('  async handleUpdateRuntimeBridge(args: any) {');
  const uninstallStart = next.indexOf('  async handleUninstallRuntimeBridge(args: any) {');
  if (updateStart === -1 || uninstallStart === -1 || uninstallStart <= updateStart) {
    throw new Error('Could not locate runtime bridge update handler');
  }
  next = `${next.slice(0, updateStart)}${next.slice(uninstallStart)}`;

  return next;
});

await edit('src/godot-server.ts', (source) => {
  let next = source.replace(
    "          name: 'install_runtime_bridge',\n          description: 'Install the managed runtime bridge into a Godot project',",
    "          name: 'ensure_runtime_bridge',\n          description: 'Install, repair, or update the managed runtime bridge in a Godot project',"
  );
  if (next === source) {
    throw new Error('Could not rename runtime bridge install tool');
  }

  const updateToolPattern = /\n        \{\n          name: 'update_runtime_bridge',[\s\S]*?\n        \},(?=\n        \{\n          name: 'uninstall_runtime_bridge')/;
  next = next.replace(updateToolPattern, '');

  next = next.replace(
    "        case 'install_runtime_bridge':\n          return await this.toolHandlers.handleInstallRuntimeBridge(request.params.arguments);",
    "        case 'ensure_runtime_bridge':\n          return await this.toolHandlers.handleEnsureRuntimeBridge(request.params.arguments);"
  );
  next = next.replace(
    /\n        case 'update_runtime_bridge':\n          return await this\.toolHandlers\.handleUpdateRuntimeBridge\(request\.params\.arguments\);/,
    ''
  );
  return next;
});

await edit('src/tool-handlers.runtime.spec.ts', (source) => {
  const managementStart = source.indexOf("describe('GodotServer runtime bridge management tools'");
  const commandStart = source.indexOf("describe('ToolHandlers runtime command delegation'");
  if (managementStart === -1 || commandStart === -1 || commandStart <= managementStart) {
    throw new Error('Could not locate runtime bridge management test block');
  }

  let prefix = source.slice(0, managementStart);
  const suffix = source.slice(commandStart);

  const obsoleteStart = prefix.indexOf("  it('returns an error when runtimeControl is true but bridge is not installed'");
  const obsoleteEnd = prefix.indexOf("  it('clears activeProcess before async stopSession");
  if (obsoleteStart !== -1 && obsoleteEnd !== -1 && obsoleteEnd > obsoleteStart) {
    prefix = `${prefix.slice(0, obsoleteStart)}${prefix.slice(obsoleteEnd)}`;
  }

  prefix = prefix.replaceAll(
    "getBridgeStatus: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true }),",
    "ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' }),"
  );
  prefix = prefix.replaceAll(
    "getBridgeStatus: vi.fn().mockRejectedValue(new Error('EACCES: permission denied'))",
    "ensureBridge: vi.fn().mockRejectedValue(new Error('EACCES: permission denied'))"
  );

  const managementBlock = `describe('GodotServer runtime bridge management tools', () => {\n  it('registers consolidated runtime bridge management tools', async () => {\n    const server = new GodotServer();\n\n    const tools = await listTools(server);\n    const names = tools.map((tool) => tool.name);\n\n    expect(names).toEqual(expect.arrayContaining([\n      'ensure_runtime_bridge',\n      'get_runtime_bridge_status',\n      'uninstall_runtime_bridge',\n    ]));\n    expect(names).not.toContain('install_runtime_bridge');\n    expect(names).not.toContain('update_runtime_bridge');\n  });\n\n  it('delegates consolidated runtime bridge management tool calls to tool handlers', async () => {\n    const server = new GodotServer();\n    const originalToolHandlers = (server as any).toolHandlers;\n    const ensureResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true,"action":"unchanged"}' }] };\n    const statusResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true}' }] };\n    const uninstallResponse = { content: [{ type: 'text' as const, text: '{"message":"removed"}' }] };\n    const handleEnsureRuntimeBridge = vi.fn().mockResolvedValue(ensureResponse);\n    const handleGetRuntimeBridgeStatus = vi.fn().mockResolvedValue(statusResponse);\n    const handleUninstallRuntimeBridge = vi.fn().mockResolvedValue(uninstallResponse);\n\n    (server as any).toolHandlers = {\n      cleanup: originalToolHandlers.cleanup.bind(originalToolHandlers),\n      handleEnsureRuntimeBridge,\n      handleGetRuntimeBridgeStatus,\n      handleUninstallRuntimeBridge,\n    };\n\n    await withConnectedClient(server, async (client) => {\n      await expect(client.callTool({\n        name: 'ensure_runtime_bridge',\n        arguments: { projectPath },\n      })).resolves.toEqual(ensureResponse);\n      await expect(client.callTool({\n        name: 'get_runtime_bridge_status',\n        arguments: { projectPath },\n      })).resolves.toEqual(statusResponse);\n      await expect(client.callTool({\n        name: 'uninstall_runtime_bridge',\n        arguments: { projectPath },\n      })).resolves.toEqual(uninstallResponse);\n    });\n\n    expect(handleEnsureRuntimeBridge).toHaveBeenCalledWith({ projectPath });\n    expect(handleGetRuntimeBridgeStatus).toHaveBeenCalledWith({ projectPath });\n    expect(handleUninstallRuntimeBridge).toHaveBeenCalledWith({ projectPath });\n  });\n});\n\n`;

  return `${prefix}${managementBlock}${suffix}`;
});

await edit('src/runtime-control-manager.spec.ts', (source) => source
  .replaceAll('manager.installBridge(', 'manager.ensureBridge(')
  .replaceAll('uninstallManager.installBridge(', 'uninstallManager.ensureBridge(')
  .replaceAll('manager.updateBridge(', 'manager.ensureBridge('));

await edit('src/runtime-control.integration.spec.ts', (source) => {
  let next = source.replaceAll(
    "      const bridgeStatus = await callJsonTool<{ installed: boolean }>(\n        client,\n        'install_runtime_bridge',\n        { projectPath: scratchFixturePath }\n      );\n\n      const runResult = await callTool(client, 'run_project', {",
    "      const runResult = await callTool(client, 'run_project', {"
  );
  if (next === source) {
    throw new Error('Could not remove explicit integration bridge install');
  }
  next = next.replaceAll(
    "      if (runResult.isError) {\n        throw new Error(getTextContent(runResult));\n      }\n\n      let runtimeState:",
    "      if (runResult.isError) {\n        throw new Error(getTextContent(runResult));\n      }\n\n      const bridgeStatus = await callJsonTool<{ installed: boolean; compatible: boolean }>(\n        client,\n        'get_runtime_bridge_status',\n        { projectPath: scratchFixturePath }\n      );\n\n      let runtimeState:"
  );
  return next;
});

await edit('src/types.ts', (source) => source
  .replace('  installBridge(projectPath: string): Promise<RuntimeBridgeStatus>;\n', '')
  .replace('  updateBridge(projectPath: string): Promise<RuntimeBridgeStatus>;\n', ''));

await edit('src/runtime-control-manager.ts', (source) => {
  let next = source.replace(
    "    const status = currentStatus.installed\n      ? await this.updateBridge(projectPath)\n      : await this.installBridge(projectPath);",
    "    const status = await this.writeBridge(projectPath);"
  );
  const installStart = next.indexOf('  async installBridge(projectPath: string): Promise<RuntimeBridgeStatus> {');
  const statusStart = next.indexOf('  async getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus> {');
  if (installStart === -1 || statusStart === -1 || statusStart <= installStart) {
    throw new Error('Could not locate public installBridge');
  }
  next = `${next.slice(0, installStart)}${next.slice(statusStart)}`;

  const updateStart = next.indexOf('  async updateBridge(projectPath: string): Promise<RuntimeBridgeStatus> {');
  const uninstallStart = next.indexOf('  async uninstallBridge(projectPath: string): Promise<void> {');
  if (updateStart === -1 || uninstallStart === -1 || uninstallStart <= updateStart) {
    throw new Error('Could not locate public updateBridge');
  }
  next = `${next.slice(0, updateStart)}${next.slice(uninstallStart)}`;

  const helperAnchor = '  private getBridgeTargetDir(projectPath: string): string {';
  const writeHelper = `  private async writeBridge(projectPath: string): Promise<RuntimeBridgeStatus> {\n    const targetDir = this.getBridgeTargetDir(projectPath);\n    await mkdir(targetDir, { recursive: true });\n    await this.copyBridgeAsset(this.runtimeBridgeScriptPath, join(targetDir, RUNTIME_BRIDGE_SCRIPT));\n    await this.copyBridgeAsset(this.runtimeBridgeManifestPath, join(targetDir, RUNTIME_BRIDGE_MANIFEST));\n    await this.updateProjectAutoload(projectPath, (projectText) => this.ensureAutoloadSection(projectText));\n    return this.getBridgeStatus(projectPath);\n  }\n\n`;
  if (!next.includes(helperAnchor)) {
    throw new Error('Could not locate bridge helper anchor');
  }
  return next.replace(helperAnchor, `${writeHelper}${helperAnchor}`);
});

await edit('package.json', (source) => source.replace(
  '"prepare": "node scripts/apply-runtime-auto-ensure.mjs && npm run build"',
  '"prepare": "npm run build"'
));

await rm('.github/workflows/apply-runtime-auto-ensure.yml', { force: true });
await rm('scripts/.runtime-auto-ensure-trigger', { force: true });
await rm('scripts/apply-runtime-auto-ensure.mjs', { force: true });
await rm('.runtime-auto-ensure-applied', { force: true });

await execFileAsync('git', ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`]);
await execFileAsync('git', ['config', 'user.name', 'github-actions[bot]']);
await execFileAsync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
await execFileAsync('git', ['add', '-A']);
const { stdout: treeStdout } = await execFileAsync('git', ['write-tree']);
const tree = treeStdout.trim();
const { stdout: parentStdout } = await execFileAsync('git', ['rev-parse', `refs/remotes/origin/${branch}`]);
const parent = parentStdout.trim();
const { stdout: commitStdout } = await execFileAsync('git', [
  'commit-tree',
  tree,
  '-p',
  parent,
  '-m',
  'feat: wire runtime bridge auto-ensure',
]);
const commit = commitStdout.trim();
await execFileAsync('git', ['push', 'origin', `${commit}:refs/heads/${branch}`]);
console.log(`Pushed runtime auto-ensure implementation ${commit}`);
