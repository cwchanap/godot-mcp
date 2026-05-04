import { accessSync, constants, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { RuntimeBridgeStatus, RuntimeLaunchSession, RuntimeState } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_BRIDGE_DIRNAME = 'godot_mcp_runtime';
const RUNTIME_BRIDGE_SCRIPT = 'runtime_bridge.gd';
const RUNTIME_BRIDGE_MANIFEST = 'bridge_manifest.json';
const GENERATED_BRIDGE_MANIFEST = 'runtime_bridge_manifest.json';
const GODOT_PROJECT_FILE = 'project.godot';
const AUTOLOAD_SECTION_HEADER = '[autoload]';
const RUNTIME_BRIDGE_AUTOLOAD_KEY = 'autoload/GodotMcpRuntimeBridge=';
const RUNTIME_BRIDGE_AUTOLOAD_LINE =
  'autoload/GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';

type RuntimeControlManagerOptions = {
  runtimeBridgeAssetsDir?: string;
  sendCommand?: (command: RuntimeCommand) => Promise<unknown>;
};

type RuntimeConnectionStatus = 'idle' | 'pending' | 'connected' | 'disconnected';

type RuntimeHandshakeRequest = {
  token: string;
  version: string;
  sessionId: string;
  projectPath: string;
  scenePath?: string | null;
};

type RuntimeCommand =
  | {
    command: 'find_node';
    nodePath: string;
  }
  | {
    command: 'change_scene';
    scenePath: string;
  }
  | {
    command: 'invoke_node_action';
    nodePath: string;
    action: string;
  };

const SUPPORTED_NODE_ACTIONS = new Map<string, string[]>([
  ['BaseButton', ['press']],
]);

const SUPPORTED_NODE_ACTION_SET = new Set(
  Array.from(SUPPORTED_NODE_ACTIONS.values()).flat()
);

export class RuntimeControlManager {
  private readonly runtimeBridgeAssetsDir: string;
  private readonly runtimeBridgeScriptPath: string;
  private readonly runtimeBridgeManifestPath: string;
  private readonly commandSender: (command: RuntimeCommand) => Promise<unknown>;
  private bridgeVersion: string | null = null;
  private nextSessionNumber = 1;
  private activeRuntimeSession: RuntimeLaunchSession | null = null;
  private activeSessionId: string | null = null;
  private runtimeState: RuntimeState = { connected: false, sessionId: null, scenePath: null };
  private connectionStatus: RuntimeConnectionStatus = 'idle';

  constructor(options: RuntimeControlManagerOptions = {}) {
    this.runtimeBridgeAssetsDir = options.runtimeBridgeAssetsDir ?? join(__dirname, '..', 'build', 'scripts');
    this.runtimeBridgeScriptPath = join(this.runtimeBridgeAssetsDir, RUNTIME_BRIDGE_SCRIPT);
    this.runtimeBridgeManifestPath = join(this.runtimeBridgeAssetsDir, GENERATED_BRIDGE_MANIFEST);
    this.commandSender = options.sendCommand ?? (async () => {
      throw new Error('Runtime bridge command transport unavailable.');
    });
  }

  getRuntimeState(): RuntimeState {
    return { ...this.runtimeState };
  }

  async startSession(projectPath: string): Promise<RuntimeLaunchSession> {
    const sessionNumber = this.nextSessionNumber++;
    const session = {
      projectPath,
      port: 4100,
      token: `token-${sessionNumber}`,
      sessionId: `session-${sessionNumber}`,
    };

    this.activeRuntimeSession = session;
    this.setActiveSessionForTest(session.sessionId);
    return session;
  }

  async stopSession(): Promise<void> {
    this.activeRuntimeSession = null;
    this.setActiveSessionForTest(null);
  }

  async acceptHandshake(payload: RuntimeHandshakeRequest): Promise<void> {
    if (!this.activeRuntimeSession) {
      throw new Error('No active runtime session.');
    }

    if (payload.token !== this.activeRuntimeSession.token) {
      throw new Error('Invalid token');
    }

    if (payload.version !== this.getGeneratedBridgeVersion()) {
      throw new Error('Bridge version mismatch');
    }

    if (payload.projectPath !== this.activeRuntimeSession.projectPath) {
      throw new Error('Bridge connected for the wrong project');
    }

    if (payload.sessionId !== this.activeRuntimeSession.sessionId) {
      throw new Error('Bridge session mismatch');
    }

    this.connectionStatus = 'connected';
    this.runtimeState = {
      connected: true,
      sessionId: payload.sessionId,
      scenePath: payload.scenePath ?? this.runtimeState.scenePath,
    };
  }

  async findNode(nodePath: string): Promise<unknown> {
    return this.sendCommand({ command: 'find_node', nodePath });
  }

  async changeScene(scenePath: string): Promise<unknown> {
    const response = await this.sendCommand({ command: 'change_scene', scenePath });
    this.runtimeState = { ...this.runtimeState, scenePath };
    return response;
  }

  async invokeNodeAction(nodePath: string, action: string): Promise<unknown> {
    if (!this.isSupportedNodeAction(nodePath, action)) {
      throw new Error(`Unsupported node action: ${action}`);
    }

    return this.sendCommand({ command: 'invoke_node_action', nodePath, action });
  }

  async installBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
    const targetDir = this.getBridgeTargetDir(projectPath);
    await mkdir(targetDir, { recursive: true });
    await Promise.all([
      this.copyBridgeAsset(this.runtimeBridgeScriptPath, join(targetDir, RUNTIME_BRIDGE_SCRIPT)),
      this.copyBridgeAsset(this.runtimeBridgeManifestPath, join(targetDir, RUNTIME_BRIDGE_MANIFEST)),
    ]);
    await this.updateProjectAutoload(projectPath, (projectText) => this.ensureAutoloadSection(projectText));
    return this.getBridgeStatus(projectPath);
  }

  async getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus> {
    const bridgeTargetDir = this.getBridgeTargetDir(projectPath);
    const manifestPath = join(bridgeTargetDir, RUNTIME_BRIDGE_MANIFEST);
    const scriptPath = join(bridgeTargetDir, RUNTIME_BRIDGE_SCRIPT);

    const [manifestExists, scriptExists] = await Promise.all([
      this.pathExists(manifestPath),
      this.pathExists(scriptPath),
    ]);

    if (!manifestExists || !scriptExists) {
      return { installed: false, version: null, compatible: false };
    }

    let version: string | null;

    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string };
      version = manifest.version ?? null;
    } catch {
      return { installed: true, version: null, compatible: false };
    }

    return {
      installed: true,
      version,
      compatible: version === this.getGeneratedBridgeVersion(),
    };
  }

  async updateBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
    return this.installBridge(projectPath);
  }

  async uninstallBridge(projectPath: string): Promise<void> {
    if (this.activeSessionId) {
      throw new Error('Cannot uninstall runtime bridge while a running session is active.');
    }

    await this.updateProjectAutoload(projectPath, (projectText) => this.removeOwnedAutoload(projectText));
    await rm(this.getBridgeTargetDir(projectPath), { recursive: true, force: true });
  }

  setActiveSessionForTest(sessionId: string | null): void {
    this.activeSessionId = sessionId;

    if (sessionId === null) {
      this.connectionStatus = 'idle';
      this.runtimeState = { connected: false, sessionId: null, scenePath: null };
      return;
    }

    if (this.runtimeState.sessionId !== sessionId) {
      this.connectionStatus = 'pending';
      this.runtimeState = {
        connected: false,
        sessionId,
        scenePath: null,
      };
    }
  }

  setConnectedSessionForTest(session: { sessionId: string; scenePath: string | null }): void {
    this.activeSessionId = session.sessionId;
    this.connectionStatus = 'connected';
    this.runtimeState = {
      connected: true,
      sessionId: session.sessionId,
      scenePath: session.scenePath,
    };
  }

  setDisconnectedForTest(): void {
    this.markDisconnected();
  }

  private getBridgeTargetDir(projectPath: string): string {
    return join(projectPath, 'addons', RUNTIME_BRIDGE_DIRNAME);
  }

  private async copyBridgeAsset(sourcePath: string, destinationPath: string): Promise<void> {
    await copyFile(sourcePath, destinationPath);
  }

  private async updateProjectAutoload(projectPath: string, update: (projectText: string) => string): Promise<void> {
    const projectFilePath = join(projectPath, GODOT_PROJECT_FILE);
    const projectText = await readFile(projectFilePath, 'utf8');
    const updatedProjectText = update(projectText);

    if (updatedProjectText !== projectText) {
      await writeFile(projectFilePath, updatedProjectText);
    }
  }

  private ensureAutoloadSection(projectText: string): string {
    if (!projectText.includes(AUTOLOAD_SECTION_HEADER)) {
      return `${projectText.trim()}\n\n${AUTOLOAD_SECTION_HEADER}\n${RUNTIME_BRIDGE_AUTOLOAD_LINE}\n`;
    }

    return this.updateAutoloadSection(projectText, (autoloadLines) => [
      RUNTIME_BRIDGE_AUTOLOAD_LINE,
      ...autoloadLines.filter((line) => !this.isOwnedAutoloadLine(line)),
    ]);
  }

  private removeOwnedAutoload(projectText: string): string {
    if (!projectText.includes(AUTOLOAD_SECTION_HEADER)) {
      return projectText;
    }

    return this.updateAutoloadSection(projectText, (autoloadLines) =>
      autoloadLines.filter((line) => !this.isOwnedAutoloadLine(line))
    );
  }

  private updateAutoloadSection(projectText: string, update: (autoloadLines: string[]) => string[]): string {
    const lines = projectText.split('\n');
    const autoloadIndex = lines.findIndex((line) => line.trim() === AUTOLOAD_SECTION_HEADER);

    if (autoloadIndex === -1) {
      return projectText;
    }

    const autoloadEndIndex = lines.findIndex(
      (line, index) => index > autoloadIndex && line.startsWith('[') && line.endsWith(']')
    );
    const autoloadLines = lines.slice(autoloadIndex + 1, autoloadEndIndex === -1 ? undefined : autoloadEndIndex);
    const updatedAutoloadLines = update(autoloadLines);
    const updatedLines = [
      ...lines.slice(0, autoloadIndex + 1),
      ...updatedAutoloadLines,
      ...(autoloadEndIndex === -1 ? [] : lines.slice(autoloadEndIndex)),
    ];

    return projectText.endsWith('\n') ? `${updatedLines.join('\n')}\n` : updatedLines.join('\n');
  }

  private isOwnedAutoloadLine(line: string): boolean {
    return line.trim().startsWith(RUNTIME_BRIDGE_AUTOLOAD_KEY);
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private getGeneratedBridgeVersion(): string {
    if (this.bridgeVersion) {
      return this.bridgeVersion;
    }

    try {
      accessSync(this.runtimeBridgeScriptPath, constants.F_OK);
    } catch {
      throw new Error(`Generated runtime bridge script is missing: ${this.runtimeBridgeScriptPath}`);
    }

    const manifest = JSON.parse(readFileSync(this.runtimeBridgeManifestPath, 'utf8')) as { version?: string };

    if (!manifest.version) {
      throw new Error(`Generated runtime bridge manifest is missing a version: ${this.runtimeBridgeManifestPath}`);
    }

    this.bridgeVersion = manifest.version;
    return this.bridgeVersion;
  }

  private async sendCommand(command: RuntimeCommand): Promise<unknown> {
    if (!this.runtimeState.sessionId) {
      throw new Error('Runtime bridge not connected.');
    }

    if (this.connectionStatus === 'disconnected' || !this.runtimeState.connected) {
      if (this.connectionStatus === 'disconnected') {
        throw new Error('Runtime bridge reconnect-required.');
      }

      throw new Error('Runtime bridge not connected.');
    }

    try {
      return await this.commandSender(command);
    } catch {
      this.markDisconnected();
      throw new Error('Runtime bridge reconnect-required.');
    }
  }

  private isSupportedNodeAction(nodePath: string, action: string): boolean {
    if (!SUPPORTED_NODE_ACTION_SET.has(action)) {
      return false;
    }

    const nodeName = nodePath.split('/').filter(Boolean).pop() ?? '';
    return /button/i.test(nodeName);
  }

  private markDisconnected(): void {
    this.connectionStatus = this.runtimeState.sessionId ? 'disconnected' : 'idle';
    this.runtimeState = {
      ...this.runtimeState,
      connected: false,
    };
  }
}
