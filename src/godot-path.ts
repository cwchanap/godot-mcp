/**
 * Godot path detection and validation utilities
 */

import { normalize } from 'path';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export class GodotPathManager {
  private validatedPaths: Map<string, boolean> = new Map();
  private godotPath: string | null = null;
  private strictPathValidation: boolean = false;

  constructor(options: { strictPathValidation?: boolean; initialPath?: string } = {}) {
    this.strictPathValidation = options.strictPathValidation ?? false;

    if (options.initialPath) {
      const normalizedPath = normalize(options.initialPath);
      this.godotPath = normalizedPath;

      if (!this.isValidGodotPathSync(this.godotPath)) {
        console.warn(`[GODOT-PATH] Invalid custom Godot path provided: ${this.godotPath}`);
        this.godotPath = null;
      }
    }
  }

  /**
   * Get the current Godot path
   */
  getPath(): string | null {
    return this.godotPath;
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private logDebug(message: string): void {
    if (process.env.DEBUG === 'true') {
      console.debug(`[GODOT-PATH] ${message}`);
    }
  }

  /**
   * Synchronous validation for constructor use
   */
  private isValidGodotPathSync(path: string): boolean {
    try {
      this.logDebug(`Quick-validating Godot path: ${path}`);
      return path === 'godot' || existsSync(path);
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      return false;
    }
  }

  /**
   * Validate if a Godot path is valid and executable
   */
  async isValidGodotPath(path: string): Promise<boolean> {
    // Check cache first
    if (this.validatedPaths.has(path)) {
      return this.validatedPaths.get(path)!;
    }

    try {
      this.logDebug(`Validating Godot path: ${path}`);

      // Check if the file exists (skip for 'godot' which might be in PATH)
      if (path !== 'godot' && !existsSync(path)) {
        this.logDebug(`Path does not exist: ${path}`);
        this.validatedPaths.set(path, false);
        return false;
      }

      // Try to execute Godot with --version flag
      const command = path === 'godot' ? 'godot --version' : `"${path}" --version`;
      await execAsync(command);

      this.logDebug(`Valid Godot path: ${path}`);
      this.validatedPaths.set(path, true);
      return true;
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      this.validatedPaths.set(path, false);
      return false;
    }
  }

  /**
   * Detect the Godot executable path based on the operating system
   */
  async detectGodotPath(): Promise<void> {
    // If godotPath is already set and valid, use it
    if (this.godotPath && await this.isValidGodotPath(this.godotPath)) {
      this.logDebug(`Using existing Godot path: ${this.godotPath}`);
      return;
    }

    // Check environment variable next
    if (process.env.GODOT_PATH) {
      const normalizedPath = normalize(process.env.GODOT_PATH);
      this.logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Using Godot path from environment: ${this.godotPath}`);
        return;
      } else {
        this.logDebug(`GODOT_PATH environment variable is invalid`);
      }
    }

    // Auto-detect based on platform
    const osPlatform = process.platform;
    this.logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);

    const possiblePaths: string[] = [
      'godot', // Check if 'godot' is in PATH first
    ];

    // Add platform-specific paths
    if (osPlatform === 'darwin') {
      possiblePaths.push(
        '/Applications/Godot.app/Contents/MacOS/Godot',
        '/Applications/Godot_mono.app/Contents/MacOS/Godot',
        '/Applications/Godot_4.app/Contents/MacOS/Godot',
        `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_mono.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
      );
    } else if (osPlatform === 'win32') {
      possiblePaths.push(
        'C:\\Program Files\\Godot\\Godot.exe',
        'C:\\Program Files (x86)\\Godot\\Godot.exe',
        'C:\\Program Files\\Godot_4\\Godot.exe',
        'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
        `${process.env.USERPROFILE}\\Godot\\Godot.exe`
      );
    } else if (osPlatform === 'linux') {
      possiblePaths.push(
        '/usr/bin/godot',
        '/usr/local/bin/godot',
        '/snap/bin/godot',
        `${process.env.HOME}/.local/bin/godot`
      );
    }

    // Try each possible path
    for (const path of possiblePaths) {
      const normalizedPath = normalize(path);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Found Godot at: ${normalizedPath}`);
        return;
      }
    }

    // If we get here, we couldn't find Godot
    this.logDebug(`Warning: Could not find Godot in common locations for ${osPlatform}`);
    console.warn(`[GODOT-PATH] Could not find Godot in common locations for ${osPlatform}`);
    console.warn(`[GODOT-PATH] Set GODOT_PATH=/path/to/godot environment variable or provide a valid path in config to specify the correct path.`);

    if (this.strictPathValidation) {
      // In strict mode, throw an error
      throw new Error(`Could not find a valid Godot executable. Set GODOT_PATH or provide a valid path in config.`);
    } else {
      // Fallback to a default path in non-strict mode; pick the first candidate that exists
      let fallbackCandidates: string[] = [];

      if (osPlatform === 'win32') {
        fallbackCandidates = ['C\\\\Program Files\\\\Godot\\\\Godot.exe'];
      } else if (osPlatform === 'darwin') {
        fallbackCandidates = [
          '/Applications/Godot.app/Contents/MacOS/Godot',
          '/Applications/Godot_mono.app/Contents/MacOS/Godot',
        ];
      } else {
        fallbackCandidates = ['/usr/bin/godot'];
      }

      const selectedFallback = fallbackCandidates.find(candidate => existsSync(candidate)) ?? fallbackCandidates[0];

      this.godotPath = normalize(selectedFallback);

      this.logDebug(`Using default path: ${this.godotPath}, but this may not work.`);
      console.warn(`[GODOT-PATH] Using default path: ${this.godotPath}, but this may not work.`);
      console.warn(`[GODOT-PATH] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.`);
    }
  }

  /**
   * Set a custom Godot path
   */
  async setGodotPath(customPath: string): Promise<boolean> {
    if (!customPath) {
      return false;
    }

    const normalizedPath = normalize(customPath);
    if (await this.isValidGodotPath(normalizedPath)) {
      this.godotPath = normalizedPath;
      this.logDebug(`Godot path set to: ${normalizedPath}`);
      return true;
    }

    this.logDebug(`Failed to set invalid Godot path: ${normalizedPath}`);
    return false;
  }
}
