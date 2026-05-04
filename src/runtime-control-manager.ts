import { randomUUID } from 'node:crypto';
import { accessSync, constants, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join, normalize, parse, resolve } from 'path';
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

type RuntimeBridgeMessage = Record<string, unknown> & {
  command?: string;
  requestId?: string;
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

type RuntimeFindNodeResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    found?: boolean;
    nodePath?: string;
    nodeType?: string;
  };
};

type RuntimeChangeSceneResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    scenePath?: string;
  };
};

type RuntimePendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type ActiveRuntimeSession = RuntimeLaunchSession & {
  expectedProjectPath: string;
  server: Server;
  socket: Socket | null;
  receiveBuffer: string;
  pendingRequests: Map<string, RuntimePendingRequest>;
  nextRequestNumber: number;
  connected: boolean;
};

const BUTTON_LIKE_NODE_TYPES = new Set([
  'BaseButton',
  'Button',
  'CheckBox',
  'CheckButton',
  'ColorPickerButton',
  'LinkButton',
  'MenuButton',
  'OptionButton',
  'TextureButton',
]);

const SUPPORTED_NODE_ACTIONS = new Map<string, ReadonlySet<string>>([
  ['press', BUTTON_LIKE_NODE_TYPES],
]);

const SUPPORTED_NODE_ACTION_SET = new Set(SUPPORTED_NODE_ACTIONS.keys());

export class RuntimeControlManager {
  private readonly runtimeBridgeAssetsDir: string;
  private readonly runtimeBridgeScriptPath: string;
  private readonly runtimeBridgeManifestPath: string;
  private readonly commandSender: (command: RuntimeCommand) => Promise<unknown>;
  private bridgeVersion: string | null = null;
  private nextSessionNumber = 1;
  private activeRuntimeSession: ActiveRuntimeSession | null = null;
  private activeSessionId: string | null = null;
  private runtimeState: RuntimeState = { connected: false, sessionId: null, scenePath: null };
  private connectionStatus: RuntimeConnectionStatus = 'idle';

  constructor(options: RuntimeControlManagerOptions = {}) {
    this.runtimeBridgeAssetsDir = options.runtimeBridgeAssetsDir ?? join(__dirname, '..', 'build', 'scripts');
    this.runtimeBridgeScriptPath = join(this.runtimeBridgeAssetsDir, RUNTIME_BRIDGE_SCRIPT);
    this.runtimeBridgeManifestPath = join(this.runtimeBridgeAssetsDir, GENERATED_BRIDGE_MANIFEST);
    this.commandSender = options.sendCommand ?? ((command) => this.sendCommandOverSocket(command));
  }

  getRuntimeState(): RuntimeState {
    return { ...this.runtimeState };
  }

  async startSession(projectPath: string): Promise<RuntimeLaunchSession> {
    await this.stopSession();

    const sessionNumber = this.nextSessionNumber++;
    const server = createServer((socket) => this.handleBridgeConnection(socket));
    await this.listen(server);
    const address = server.address();

    if (!address || typeof address === 'string') {
      await this.closeServer(server);
      throw new Error('Failed to create runtime bridge listener.');
    }

    const session: ActiveRuntimeSession = {
      projectPath,
      expectedProjectPath: this.normalizeProjectPath(projectPath),
      port: address.port,
      token: randomUUID(),
      sessionId: `session-${sessionNumber}`,
      server,
      socket: null,
      receiveBuffer: '',
      pendingRequests: new Map(),
      nextRequestNumber: 1,
      connected: false,
    };

    this.activeRuntimeSession = session;
    this.setActiveSessionForTest(session.sessionId);

    return {
      projectPath: session.projectPath,
      port: session.port,
      token: session.token,
      sessionId: session.sessionId,
    };
  }

  async stopSession(): Promise<void> {
    const session = this.activeRuntimeSession;
    this.activeRuntimeSession = null;

    if (session) {
      this.clearPendingRequests(session, new Error('Runtime session stopped.'));
      session.socket?.destroy();
      await this.closeServer(session.server);
    }

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

    if (this.normalizeProjectPath(payload.projectPath) !== this.activeRuntimeSession.expectedProjectPath) {
      throw new Error('Bridge connected for the wrong project');
    }

    if (payload.sessionId !== this.activeRuntimeSession.sessionId) {
      throw new Error('Bridge session mismatch');
    }

    this.connectionStatus = 'connected';
    this.activeRuntimeSession.connected = true;
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
    const response = await this.sendCommand({ command: 'change_scene', scenePath }) as RuntimeChangeSceneResponse;
    if (response?.ok === true) {
      this.runtimeState = { ...this.runtimeState, scenePath };
    }
    return response;
  }

  async invokeNodeAction(nodePath: string, action: string): Promise<unknown> {
    const nodeType = await this.resolveNodeType(nodePath, action);

    if (!this.isSupportedNodeAction(nodeType, action)) {
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

  private async sendCommandOverSocket(command: RuntimeCommand): Promise<unknown> {
    const session = this.activeRuntimeSession;
    const socket = session?.socket;

    if (!session || !socket || socket.destroyed) {
      throw new Error('Runtime bridge command transport unavailable.');
    }

    const requestId = `${session.sessionId}:${session.nextRequestNumber++}`;

    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      session.pendingRequests.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
      });

      void this.sendSocketMessage(socket, {
        requestId,
        ...command,
      }).catch((error) => {
        if (session.pendingRequests.delete(requestId)) {
          rejectRequest(error);
        }
      });
    });
  }

  private async resolveNodeType(nodePath: string, action: string): Promise<string> {
    if (!SUPPORTED_NODE_ACTION_SET.has(action)) {
      throw new Error(`Unsupported node action: ${action}`);
    }

    const response = await this.findNode(nodePath) as RuntimeFindNodeResponse;

    if (!response || response.ok !== true) {
      throw new Error(response.error ?? `Failed to resolve runtime node metadata for ${nodePath}`);
    }

    if (response.result?.found !== true || typeof response.result.nodeType !== 'string' || response.result.nodeType.length === 0) {
      throw new Error(`Failed to resolve runtime node metadata for ${nodePath}`);
    }

    return response.result.nodeType;
  }

  private isSupportedNodeAction(nodeType: string, action: string): boolean {
    if (!SUPPORTED_NODE_ACTION_SET.has(action)) {
      return false;
    }

    return SUPPORTED_NODE_ACTIONS.get(action)?.has(nodeType) ?? false;
  }

  private markDisconnected(): void {
    if (this.activeRuntimeSession) {
      this.activeRuntimeSession.connected = false;
    }
    this.connectionStatus = this.runtimeState.sessionId ? 'disconnected' : 'idle';
    this.runtimeState = {
      ...this.runtimeState,
      connected: false,
    };
  }

  private handleBridgeConnection(socket: Socket): void {
    const session = this.activeRuntimeSession;

    if (!session) {
      socket.destroy();
      return;
    }

    if (session.socket && !session.socket.destroyed) {
      socket.destroy();
      return;
    }

    session.socket = socket;
    session.receiveBuffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.handleSocketData(session, socket, chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => this.handleSocketClose(session, socket));
  }

  private handleSocketData(session: ActiveRuntimeSession, socket: Socket, chunk: string | Buffer): void {
    if (this.activeRuntimeSession !== session || session.socket !== socket) {
      return;
    }

    session.receiveBuffer += chunk.toString();
    let newlineIndex = session.receiveBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const rawMessage = session.receiveBuffer.slice(0, newlineIndex).trim();
      session.receiveBuffer = session.receiveBuffer.slice(newlineIndex + 1);

      if (rawMessage.length > 0) {
        let message: RuntimeBridgeMessage;

        try {
          message = JSON.parse(rawMessage) as RuntimeBridgeMessage;
        } catch {
          this.runSocketTask(this.sendSocketMessage(socket, { ok: false, error: 'Invalid message' }));
          newlineIndex = session.receiveBuffer.indexOf('\n');
          continue;
        }

        this.runSocketTask(this.handleBridgeMessage(session, socket, message));
      }

      newlineIndex = session.receiveBuffer.indexOf('\n');
    }
  }

  private async handleBridgeMessage(
    session: ActiveRuntimeSession,
    socket: Socket,
    message: RuntimeBridgeMessage
  ): Promise<void> {
    if (message.command === 'hello') {
      try {
        await this.acceptHandshake({
          token: typeof message.token === 'string' ? message.token : '',
          version: typeof message.version === 'string' ? message.version : '',
          sessionId: typeof message.sessionId === 'string' ? message.sessionId : '',
          projectPath: typeof message.projectPath === 'string' ? message.projectPath : '',
          scenePath: typeof message.scenePath === 'string' ? message.scenePath : null,
        });
        await this.sendSocketMessage(socket, { ok: true });
      } catch (error) {
        await this.sendSocketMessage(socket, {
          ok: false,
          error: error instanceof Error ? error.message : 'Handshake failed',
        });
        socket.end();
      }
      return;
    }

    if (typeof message.requestId === 'string') {
      const pendingRequest = session.pendingRequests.get(message.requestId);
      if (!pendingRequest) {
        return;
      }

      session.pendingRequests.delete(message.requestId);
      const { requestId: _requestId, ...responsePayload } = message;
      pendingRequest.resolve(responsePayload);
      return;
    }

    await this.sendSocketMessage(socket, { ok: false, error: 'Unsupported message' });
  }

  private handleSocketClose(session: ActiveRuntimeSession, socket: Socket): void {
    if (this.activeRuntimeSession !== session || session.socket !== socket) {
      return;
    }

    const wasConnected = session.connected;
    session.socket = null;
    session.receiveBuffer = '';
    session.connected = false;
    this.clearPendingRequests(session, new Error('socket closed'));

    if (wasConnected) {
      this.markDisconnected();
    }
  }

  private clearPendingRequests(session: ActiveRuntimeSession, error: Error): void {
    for (const pendingRequest of session.pendingRequests.values()) {
      pendingRequest.reject(error);
    }
    session.pendingRequests.clear();
  }

  private async sendSocketMessage(socket: Socket, message: Record<string, unknown>): Promise<void> {
    await new Promise<void>((resolveMessage, rejectMessage) => {
      socket.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          rejectMessage(error);
          return;
        }

        resolveMessage();
      });
    });
  }

  private async listen(server: Server): Promise<void> {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        rejectListen(error);
      };

      const onListening = () => {
        server.off('error', onError);
        resolveListen();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
  }

  private async closeServer(server: Server): Promise<void> {
    if (!server.listening) {
      return;
    }

    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }

        resolveClose();
      });
    });
  }

  private normalizeProjectPath(projectPath: string): string {
    const normalizedPath = normalize(resolve(projectPath));
    const root = parse(normalizedPath).root;
    const trimmedPath = normalizedPath.length > root.length
      ? normalizedPath.replace(/[\\/]+$/, '')
      : normalizedPath;

    return process.platform === 'win32' ? trimmedPath.toLowerCase() : trimmedPath;
  }

  private runSocketTask(task: Promise<void>): void {
    void task.catch(() => undefined);
  }
}
