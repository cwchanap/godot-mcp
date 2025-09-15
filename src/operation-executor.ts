/**
 * Godot operation execution utilities
 */

import { promisify } from 'util';
import { exec } from 'child_process';
import { OperationParams, PARAMETER_MAPPINGS } from './types.js';
import { GodotPathManager } from './godot-path.js';

const execAsync = promisify(exec);

export class OperationExecutor {
  private reverseParameterMappings: Record<string, string> = {};
  private operationsScriptPath: string;

  constructor(operationsScriptPath: string) {
    this.operationsScriptPath = operationsScriptPath;

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
      console.debug(`[OPERATION-EXECUTOR] ${message}`);
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

        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[snakeKey] = this.convertCamelToSnakeCase(params[key] as OperationParams);
        } else {
          result[snakeKey] = params[key];
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
    pathManager: GodotPathManager
  ): Promise<{ stdout: string; stderr: string }> {
    this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
    this.logDebug(`Original operation params: ${JSON.stringify(params)}`);

    // Convert camelCase parameters to snake_case for Godot script
    const snakeCaseParams = this.convertCamelToSnakeCase(params);
    this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);

    // Ensure godotPath is set
    const godotPath = pathManager.getPath();
    if (!godotPath) {
      await pathManager.detectGodotPath();
      const newPath = pathManager.getPath();
      if (!newPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    try {
      // Serialize the snake_case parameters to a valid JSON string
      const paramsJson = JSON.stringify(snakeCaseParams);
      // Escape single quotes in the JSON string to prevent command injection
      const escapedParams = paramsJson.replace(/'/g, "'\\'");
      // On Windows, cmd.exe does not strip single quotes, so we use
      // double quotes and escape them to ensure the JSON is parsed
      // correctly by Godot.
      const isWindows = process.platform === 'win32';
      const quotedParams = isWindows
        ? `\\"${paramsJson.replace(/\"/g, '\\"')}\"`
        : `'${escapedParams}'`;

      // Add debug arguments if debug mode is enabled
      const debugArgs = process.env.GODOT_DEBUG_MODE === 'true' ? ['--debug-godot'] : [];

      // Construct the command with the operation and JSON parameters
      const cmd = [
        `"${godotPath}"`,
        '--headless',
        '--path',
        `"${projectPath}"`,
        '--script',
        `"${this.operationsScriptPath}"`,
        operation,
        quotedParams, // Pass the JSON string as a single argument
        ...debugArgs,
      ].join(' ');

      this.logDebug(`Command: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd);

      return { stdout, stderr };
    } catch (error: unknown) {
      // If execAsync throws, it still contains stdout/stderr
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        const execError = error as Error & { stdout: string; stderr: string };
        return {
          stdout: execError.stdout,
          stderr: execError.stderr,
        };
      }

      throw error;
    }
  }
}