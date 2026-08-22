import { readFile, writeFile } from 'node:fs/promises';

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

  const insertBefore = '  async handleInstallRuntimeBridge(args: any) {';
  if (!next.includes(insertBefore)) {
    throw new Error('Could not locate runtime bridge install handler');
  }
  const ensureHandler = `  async handleEnsureRuntimeBridge(args: any) {\n    args = this.operationExecutor.normalizeParameters(args);\n\n    if (!args.projectPath) {\n      return this.createErrorResponse(\n        'Project path is required',\n        ['Provide a valid path to a Godot project directory']\n      );\n    }\n\n    if (!ProjectUtils.validatePath(args.projectPath)) {\n      return this.createErrorResponse(\n        'Invalid project path',\n        ['Provide a valid path without ".." or other potentially unsafe characters']\n      );\n    }\n\n    try {\n      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {\n        return this.createErrorResponse(\n          \`Not a valid Godot project: \${args.projectPath}\`,\n          [\n            'Ensure the path points to a directory containing a project.godot file',\n            'Use list_projects to find valid Godot projects',\n          ]\n        );\n      }\n\n      const result = await this.runtimeControlManager.ensureBridge(args.projectPath);\n      return {\n        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],\n      };\n    } catch (error: any) {\n      return this.createErrorResponse(\n        \`Failed to ensure runtime bridge: \${error?.message || 'Unknown error'}\`,\n        ['Ensure the project path is writable and contains a valid Godot project']\n      );\n    }\n  }\n\n`;
  next = next.replace(insertBefore, `${ensureHandler}${insertBefore}`);
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

await writeFile('.runtime-auto-ensure-applied', 'applied\n');
