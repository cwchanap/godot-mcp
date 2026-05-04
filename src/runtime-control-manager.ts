import { accessSync, constants, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { RuntimeBridgeStatus, RuntimeState } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_BRIDGE_DIRNAME = 'godot_mcp_runtime';
const RUNTIME_BRIDGE_SCRIPT = 'runtime_bridge.gd';
const RUNTIME_BRIDGE_MANIFEST = 'bridge_manifest.json';
const GENERATED_BRIDGE_MANIFEST = 'runtime_bridge_manifest.json';
const GODOT_PROJECT_FILE = 'project.godot';
const AUTOLOAD_SECTION_HEADER = '[autoload]';
const RUNTIME_BRIDGE_AUTOLOAD_LINE =
  'autoload/GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';

type RuntimeControlManagerOptions = {
  runtimeBridgeAssetsDir?: string;
};

export class RuntimeControlManager {
  private readonly runtimeBridgeAssetsDir: string;
  private readonly runtimeBridgeScriptPath: string;
  private readonly runtimeBridgeManifestPath: string;
  private bridgeVersion: string | null = null;
  private activeSessionId: string | null = null;

  constructor(options: RuntimeControlManagerOptions = {}) {
    this.runtimeBridgeAssetsDir = options.runtimeBridgeAssetsDir ?? join(__dirname, '..', 'build', 'scripts');
    this.runtimeBridgeScriptPath = join(this.runtimeBridgeAssetsDir, RUNTIME_BRIDGE_SCRIPT);
    this.runtimeBridgeManifestPath = join(this.runtimeBridgeAssetsDir, GENERATED_BRIDGE_MANIFEST);
  }

  getRuntimeState(): RuntimeState {
    return { connected: false, sessionId: null, scenePath: null };
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

    await rm(this.getBridgeTargetDir(projectPath), { recursive: true, force: true });
    await this.updateProjectAutoload(projectPath, (projectText) => this.removeOwnedAutoload(projectText));
  }

  setActiveSessionForTest(sessionId: string | null): void {
    this.activeSessionId = sessionId;
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

    if (projectText.includes(RUNTIME_BRIDGE_AUTOLOAD_LINE)) {
      return projectText;
    }

    return projectText.replace(AUTOLOAD_SECTION_HEADER, `${AUTOLOAD_SECTION_HEADER}\n${RUNTIME_BRIDGE_AUTOLOAD_LINE}`);
  }

  private removeOwnedAutoload(projectText: string): string {
    return projectText
      .split('\n')
      .filter((line) => line.trim() !== RUNTIME_BRIDGE_AUTOLOAD_LINE)
      .join('\n');
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
}
