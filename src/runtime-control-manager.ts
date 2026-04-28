import { constants, readFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { RuntimeBridgeStatus, RuntimeState } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME_BRIDGE_DIRNAME = 'godot_mcp_runtime';
const RUNTIME_BRIDGE_SCRIPT = 'runtime_bridge.gd';
const RUNTIME_BRIDGE_MANIFEST = 'bridge_manifest.json';
const GENERATED_BRIDGE_MANIFEST = 'runtime_bridge_manifest.json';

export class RuntimeControlManager {
  private readonly runtimeBridgeAssetsDir = join(__dirname, '..', 'build', 'scripts');
  private readonly runtimeBridgeScriptPath = join(this.runtimeBridgeAssetsDir, RUNTIME_BRIDGE_SCRIPT);
  private readonly runtimeBridgeManifestPath = join(this.runtimeBridgeAssetsDir, GENERATED_BRIDGE_MANIFEST);
  private readonly bridgeVersion = this.readGeneratedBridgeVersion();

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
    return this.getBridgeStatus(projectPath);
  }

  async getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus> {
    const manifestPath = join(this.getBridgeTargetDir(projectPath), RUNTIME_BRIDGE_MANIFEST);

    if (!(await this.pathExists(manifestPath))) {
      return { installed: false, version: null, compatible: false };
    }

    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string };
      const version = manifest.version ?? null;

      return {
        installed: true,
        version,
        compatible: version === this.bridgeVersion,
      };
    } catch {
      return { installed: true, version: null, compatible: false };
    }
  }

  async updateBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
    await this.installBridge(projectPath);
    return this.getBridgeStatus(projectPath);
  }

  private getBridgeTargetDir(projectPath: string): string {
    return join(projectPath, 'addons', RUNTIME_BRIDGE_DIRNAME);
  }

  private async copyBridgeAsset(sourcePath: string, destinationPath: string): Promise<void> {
    await copyFile(sourcePath, destinationPath);
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private readGeneratedBridgeVersion(): string {
    const manifest = JSON.parse(readFileSync(this.runtimeBridgeManifestPath, 'utf8')) as { version?: string };

    if (!manifest.version) {
      throw new Error(`Generated runtime bridge manifest is missing a version: ${this.runtimeBridgeManifestPath}`);
    }

    return manifest.version;
  }
}
