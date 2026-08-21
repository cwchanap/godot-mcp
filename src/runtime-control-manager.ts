import { randomUUID } from 'node:crypto';
import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join, normalize, parse, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  MAX_RUNTIME_MESSAGE_BYTES,
  validateScreenshotPayload,
} from './screenshot-payload.js';
import type {
  RuntimeBridgeStatus,
  RuntimeLaunchSession,
  RuntimeState,
  ScreenshotCaptureResult,
  ScreenshotSaveDestination,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_BRIDGE_DIRNAME = 'godot_mcp_runtime';
const RUNTIME_BRIDGE_SCRIPT = 'runtime_bridge.gd';
const RUNTIME_BRIDGE_MANIFEST = 'bridge_manifest.json';
const GENERATED_BRIDGE_MANIFEST = 'runtime_bridge_manifest.json';
const GODOT_PROJECT_FILE = 'project.godot';
const AUTOLOAD_SECTION_HEADER = '[autoload]';
const RUNTIME_BRIDGE_AUTOLOAD_KEY = 'GodotMcpRuntimeBridge=';
const RUNTIME_BRIDGE_AUTOLOAD_LINE =
  'GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';

// Maximum time (ms) a pre-handshake socket may idle before the server
// destroys it. Prevents a stray localhost connection from blocking the
// real bridge.
const HANDSHAKE_TIMEOUT_MS = 5000;

// Maximum time (ms) to wait for a runtime command reply before rejecting.
const COMMAND_REPLY_TIMEOUT_MS = 10000;

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
  }
  | {
    command: 'capture_screenshot';
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
  handshakeTimer: ReturnType<typeof setTimeout> | null;
};

const SUPPORTED_NODE_ACTIONS = new Set(['press']);

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
  private screenshotCaptureInFlight = false;

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
      handshakeTimer: null,
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
      if (session.handshakeTimer) {
        clearTimeout(session.handshakeTimer);
        session.handshakeTimer = null;
      }
      this.clearPendingRequests(session, new Error('Runtime session stopped.'));
      session.socket?.destroy();
      try {
        await this.closeServer(session.server);
      } finally {
        // Only clear the active session ID if no new session was started
        // while we were waiting for the server to close.
        if (this.activeSessionId === session.sessionId) {
          this.setActiveSessionForTest(null);
        }
      }
      return;
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

    // Handshake succeeded — clear the pre-handshake deadline.
    if (this.activeRuntimeSession.handshakeTimer) {
      clearTimeout(this.activeRuntimeSession.handshakeTimer);
      this.activeRuntimeSession.handshakeTimer = null;
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
    this.validateScenePath(scenePath);
    const response = await this.sendCommand({ command: 'change_scene', scenePath }) as RuntimeChangeSceneResponse;
    if (response?.ok === true) {
      this.runtimeState = { ...this.runtimeState, scenePath };
    }
    return response;
  }

  async invokeNodeAction(nodePath: string, action: string): Promise<unknown> {
    if (!SUPPORTED_NODE_ACTIONS.has(action)) {
      throw new Error(`Unsupported node action: ${action}`);
    }

    return this.sendCommand({ command: 'invoke_node_action', nodePath, action });
  }

  async captureScreenshot(saveTo?: ScreenshotSaveDestination): Promise<ScreenshotCaptureResult> {
    this.assertRuntimeConnected();
    if (this.screenshotCaptureInFlight) {
      throw new Error('Screenshot capture already in progress.');
    }
    if (saveTo !== undefined) {
      throw new Error('Screenshot persistence is not available yet.');
    }

    this.screenshotCaptureInFlight = true;
    try {
      const response = await this.commandSender({ command: 'capture_screenshot' }) as {
        ok?: boolean;
        error?: string;
        result?: unknown;
      };
      if (response.ok !== true) {
        throw new Error(response.error ?? 'Screenshot capture failed.');
      }
      const screenshot = validateScreenshotPayload(response.result);
      return {
        data: screenshot.data,
        mimeType: screenshot.mimeType,
        width: screenshot.width,
        height: screenshot.height,
        byteLength: screenshot.byteLength,
        savedPath: null,
        saveError: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screenshot capture failed.';
      if (/timed out/i.test(message)) {
        throw new Error(`Screenshot capture timed out after ${COMMAND_REPLY_TIMEOUT_MS}ms.`);
      }
      throw error;
    } finally {
      this.screenshotCaptureInFlight = false;
    }
  }

  async installBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
    const targetDir = this.getBridgeTargetDir(projectPath);
    await mkdir(targetDir, { recursive: true });
    await this.copyBridgeAsset(this.runtimeBridgeScriptPath, join(targetDir, RUNTIME_BRIDGE_SCRIPT));
    await this.copyBridgeAsset(this.runtimeBridgeManifestPath, join(targetDir, RUNTIME_BRIDGE_MANIFEST));
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

    // An install is only considered complete when the autoload entry is also
    // present in project.godot.  A user may have hand-edited the file to
    // remove the entry, or a previous install may have left files without the
    // autoload (half-install).  Reporting installed:false in either case lets
    // the caller re-install to fix the inconsistency.
    const autoloadPresent = await this.hasOwnedAutoload(projectPath);
    if (!autoloadPresent) {
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
    // Prevent uninstalling the bridge from the project that currently has an
    // active runtime session — the running game would lose its autoload and
    // the MCP server's socket would be orphaned.  Uninstalling a *different*
    // project is safe because its bridge is not connected.
    if (this.activeSessionId) {
      const normalizedPath = this.normalizeProjectPath(projectPath);
      if (
        !this.activeRuntimeSession ||
        this.activeRuntimeSession.expectedProjectPath === normalizedPath
      ) {
        throw new Error('Cannot uninstall runtime bridge while a running session is active for this project.');
      }
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

  private async hasOwnedAutoload(projectPath: string): Promise<boolean> {
    const projectFilePath = join(projectPath, GODOT_PROJECT_FILE);
    try {
      const projectText = await readFile(projectFilePath, 'utf8');
      if (!projectText.includes(AUTOLOAD_SECTION_HEADER)) {
        return false;
      }
      const lines = projectText.split('\n');
      const autoloadIndex = lines.findIndex((line) => line.trim() === AUTOLOAD_SECTION_HEADER);
      if (autoloadIndex === -1) {
        return false;
      }
      const autoloadEndIndex = lines.findIndex(
        (line, index) => index > autoloadIndex && line.startsWith('[') && line.endsWith(']')
      );
      const autoloadLines = lines.slice(autoloadIndex + 1, autoloadEndIndex === -1 ? undefined : autoloadEndIndex);
      return autoloadLines.some((line) => line.trim() === RUNTIME_BRIDGE_AUTOLOAD_LINE);
    } catch (error: unknown) {
      // ENOENT means project.godot doesn't exist — the bridge is genuinely
      // not installed.  Any other FS error (EACCES, EISDIR, etc.) should
      // propagate so the caller can report the real problem instead of
      // directing the user into a re-install loop.
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return false;
    }
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

  private assertRuntimeConnected(): void {
    if (!this.runtimeState.sessionId) {
      throw new Error('Runtime bridge not connected.');
    }

    if (this.connectionStatus === 'disconnected' || !this.runtimeState.connected) {
      if (this.connectionStatus === 'disconnected') {
        throw new Error('Runtime bridge reconnect-required.');
      }

      throw new Error('Runtime bridge not connected.');
    }
  }

  private async sendCommand(command: RuntimeCommand): Promise<unknown> {
    this.assertRuntimeConnected();

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
      let settled = false;
      const replyTimer = setTimeout(() => {
        if (session.pendingRequests.delete(requestId)) {
          settled = true;
          rejectRequest(new Error(`Runtime command timed out after ${COMMAND_REPLY_TIMEOUT_MS}ms.`));
        }
      }, COMMAND_REPLY_TIMEOUT_MS);

      // Prevent the timer from keeping the process alive.
      if (replyTimer.unref) {
        replyTimer.unref();
      }

      const wrappedResolve = (value: unknown) => {
        clearTimeout(replyTimer);
        settled = true;
        resolveRequest(value);
      };

      const wrappedReject = (reason?: unknown) => {
        clearTimeout(replyTimer);
        if (!settled) {
          rejectRequest(reason);
        }
      };

      session.pendingRequests.set(requestId, {
        resolve: wrappedResolve,
        reject: wrappedReject,
      });

      void this.sendSocketMessage(socket, {
        requestId,
        ...command,
      }).catch((error) => {
        if (session.pendingRequests.delete(requestId)) {
          clearTimeout(replyTimer);
          rejectRequest(error);
        }
      });
    });
  }

  private validateScenePath(scenePath: string): void {
    if (!scenePath.startsWith('res://')) {
      throw new Error('Scene path must start with res://');
    }

    if (scenePath.includes('..')) {
      throw new Error('Scene path must not contain ".."');
    }
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
    socket.on('error', (error) => {
      console.error(`[RUNTIME] socket error (session ${session.sessionId}): ${error.message}`);
    });
    socket.on('close', () => this.handleSocketClose(session, socket));

    // Start a handshake deadline. If no valid hello arrives within the
    // timeout, destroy the socket so it doesn't block the real bridge.
    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
    }
    session.handshakeTimer = setTimeout(() => {
      if (session.socket === socket && !session.connected) {
        console.error(`[RUNTIME] handshake timeout for session ${session.sessionId}, closing socket`);
        socket.destroy();
      }
      session.handshakeTimer = null;
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private handleSocketData(session: ActiveRuntimeSession, socket: Socket, chunk: string | Buffer): void {
    if (this.activeRuntimeSession !== session || session.socket !== socket) {
      return;
    }

    session.receiveBuffer += chunk.toString();
    if (
      !session.receiveBuffer.includes('\n') &&
      Buffer.byteLength(session.receiveBuffer, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES
    ) {
      socket.destroy();
      return;
    }

    let newlineIndex = session.receiveBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const rawMessage = session.receiveBuffer.slice(0, newlineIndex).trim();
      session.receiveBuffer = session.receiveBuffer.slice(newlineIndex + 1);

      if (Buffer.byteLength(rawMessage, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      if (rawMessage.length > 0) {
        this.parseAndHandleBridgeMessage(session, socket, rawMessage);
      }

      newlineIndex = session.receiveBuffer.indexOf('\n');
    }

    if (
      !session.receiveBuffer.includes('\n') &&
      Buffer.byteLength(session.receiveBuffer, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES
    ) {
      socket.destroy();
    }
  }

  private parseAndHandleBridgeMessage(
    session: ActiveRuntimeSession,
    socket: Socket,
    rawMessage: string
  ): void {
    let message: RuntimeBridgeMessage;
    try {
      message = JSON.parse(rawMessage) as RuntimeBridgeMessage;
    } catch {
      this.runSocketTask(this.sendSocketMessage(socket, { ok: false, error: 'Invalid message' }));
      return;
    }
    this.runSocketTask(this.handleBridgeMessage(session, socket, message));
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

    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
      session.handshakeTimer = null;
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
    const resolved = resolve(projectPath);
    let realPath: string;
    try {
      realPath = realpathSync(resolved);
    } catch {
      realPath = resolved;
    }
    const normalizedPath = normalize(realPath);
    const root = parse(normalizedPath).root;
    const trimmedPath = normalizedPath.length > root.length
      ? normalizedPath.replace(/[\\/]+$/, '')
      : normalizedPath;

    return process.platform === 'win32' ? trimmedPath.toLowerCase() : trimmedPath;
  }

  private runSocketTask(task: Promise<void>): void {
    void task.catch((error: unknown) => {
      console.error(
        '[RUNTIME] socket task failed:',
        error instanceof Error ? error.message : error
      );
    });
  }
}
