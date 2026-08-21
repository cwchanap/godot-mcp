/**
 * Godot operation execution utilities
 */

import { promisify } from 'util';
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { OperationParams, PARAMETER_MAPPINGS } from './types.js';
import { GodotPathManager } from './godot-path.js';

const execFileAsync = promisify(execFile);

interface OperationExecutionOptions {
  useEditor?: boolean;
}

export class OperationExecutor {
  private reverseParameterMappings: Record<string, string> = {};
  private operationsScriptPath: string;
  private editorOperationsScriptPath: string;

  constructor(operationsScriptPath: string) {
    this.operationsScriptPath = operationsScriptPath;
    this.editorOperationsScriptPath = join(dirname(operationsScriptPath), 'editor_reimport.gd');

    // Initialize reverse parameter mappings
    for (const [snakeCase, camelCase] of Object.entries(PARAMETER_MAPPINGS)) {
      this.reverseParameterMappings[camelCase] = snakeCase;
    }
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private logDebug(message: string): void {
    if (process.env.DEBUG === 'true') {
      console.error(`[OPERATION-EXECUTOR] ${message}`);
    }
  }

  /**
   * Normalize parameters to camelCase format
   */
  normalizeParameters(params: OperationParams): OperationParams {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const result: OperationParams = {};

    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        let normalizedKey = key;

        // If the key is in snake_case, convert it to camelCase using our mapping
        if (key.includes('_') && PARAMETER_MAPPINGS[key]) {
          normalizedKey = PARAMETER_MAPPINGS[key];
        }

        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[normalizedKey] = this.normalizeParameters(params[key] as OperationParams);
        } else {
          result[normalizedKey] = params[key];
        }
      }
    }

    return result;
  }

  /**
   * Convert camelCase keys to snake_case
   */
  private convertCamelToSnakeCase(params: OperationParams): OperationParams {
    const result: OperationParams = {};

    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        // Convert camelCase to snake_case
        const snakeKey = this.reverseParameterMappings[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        const value = params[key];

        // Handle nested objects and arrays recursively
        if (Array.isArray(value)) {
          result[snakeKey] = value.map((item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              return this.convertCamelToSnakeCase(item as OperationParams);
            }
            return item;
          });
        } else if (typeof value === 'object' && value !== null) {
          result[snakeKey] = this.convertCamelToSnakeCase(value as OperationParams);
        } else {
          result[snakeKey] = value;
        }
      }
    }

    return result;
  }

  /**
   * Execute a Godot operation using the operations script
   */
  async executeOperation(
    operation: string,
    params: OperationParams,
    projectPath: string,
    pathManager: GodotPathManager,
    options: OperationExecutionOptions = {}
  ): Promise<{ stdout: string; stderr: string }> {
    this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
    this.logDebug(`Original operation params: ${JSON.stringify(params)}`);

    // Convert camelCase parameters to snake_case for Godot script
    const snakeCaseParams = this.convertCamelToSnakeCase(params);
    this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);

    // Ensure godotPath is set
    let godotPath = pathManager.getPath();
    if (!godotPath) {
      await pathManager.detectGodotPath();
      godotPath = pathManager.getPath();
      if (!godotPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    try {
      // Serialize the snake_case parameters to a valid JSON string
      const paramsJson = JSON.stringify(snakeCaseParams);
      let commandArgs: string[];

      if (options.useEditor) {
        commandArgs = [
          '--headless',
          '--editor',
          '--quit',
          '--path',
          projectPath,
          '--script',
          this.editorOperationsScriptPath,
          operation,
          paramsJson,
        ];
      } else {
        // Default to regular operations script
        commandArgs = [
          '--headless',
          '--path',
          projectPath,
          '--script',
          this.operationsScriptPath,
          operation,
          paramsJson,
        ];
      }

      if (process.env.GODOT_DEBUG_MODE === 'true') {
        commandArgs.push('--debug-godot');
      }

      this.logDebug(`Executing: ${godotPath} ${commandArgs.join(' ')}`);

      const { stdout, stderr } = await execFileAsync(godotPath, commandArgs);
      return { stdout: stdout ?? '', stderr: stderr ?? '' };
    } catch (error: unknown) {
      // If execFileAsync throws, it still contains stdout/stderr
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        const execError = error as Error & { stdout: string; stderr: string };
        return {
          stdout: execError.stdout ?? '',
          stderr: execError.stderr ?? '',
        };
      }

      throw error;
    }
  }
}
