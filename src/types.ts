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