/**
 * Type definitions and interfaces for the Godot MCP Server
 */

/**
 * Interface representing a running Godot process
 */
export interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

/**
 * Interface for server configuration
 */
export interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
  godotDebugMode?: boolean;
  strictPathValidation?: boolean;
}

/**
 * Interface for operation parameters
 */
export interface OperationParams {
  [key: string]: any;
}

/**
 * Parameter name mappings between snake_case and camelCase
 */
export const PARAMETER_MAPPINGS: Record<string, string> = {
  'project_path': 'projectPath',
  'runtime_control': 'runtimeControl',
  'scene_path': 'scenePath',
  'root_node_type': 'rootNodeType',
  'parent_node_path': 'parentNodePath',
  'node_type': 'nodeType',
  'node_name': 'nodeName',
  'texture_path': 'texturePath',
  'node_path': 'nodePath',
  'output_path': 'outputPath',
  'mesh_item_names': 'meshItemNames',
  'new_path': 'newPath',
  'file_path': 'filePath',
  'directory': 'directory',
  'recursive': 'recursive',
  'scene': 'scene',
  'tilemap_path': 'tilemapPath',
  'tilemap_layer_path': 'tilemapLayerPath',
  'tileset_path': 'tilesetPath',
  'tilemap_name': 'tilemapName',
  'save_to': 'saveTo',
};

/**
 * Project structure interface
 */
export interface ProjectStructure {
  scenes: number;
  scripts: number;
  assets: number;
  other: number;
  error?: string;
}

/**
 * Project info interface
 */
export interface ProjectInfo {
  name: string;
  path: string;
  godotVersion: string;
  structure: ProjectStructure;
}

/**
 * Godot project reference
 */
export interface GodotProjectRef {
  path: string;
  name: string;
}

export interface RuntimeState {
  connected: boolean;
  sessionId: string | null;
  scenePath: string | null;
}

export interface RuntimeLaunchSession {
  projectPath: string;
  port: number;
  token: string;
  sessionId: string;
}

export type ScreenshotSaveDestination = 'temporary' | 'project';

export interface ScreenshotCaptureResult {
  data: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  byteLength: number;
  savedPath: string | null;
  saveError: string | null;
}

export interface RuntimeControlSessionManager {
  startSession(projectPath: string): Promise<RuntimeLaunchSession>;
  stopSession(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface RuntimeBridgeManager extends RuntimeControlSessionManager {
  installBridge(projectPath: string): Promise<RuntimeBridgeStatus>;
  getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus>;
  updateBridge(projectPath: string): Promise<RuntimeBridgeStatus>;
  uninstallBridge(projectPath: string): Promise<void>;
}

export interface RuntimeBridgeStatus {
  installed: boolean;
  version: string | null;
  compatible: boolean;
}
