/**
 * Godot project utilities for validation, discovery, and structure analysis
 */

import { join, basename } from 'path';
import { existsSync, readdirSync } from 'fs';
import { GodotProjectRef, ProjectStructure } from './types.js';

export class ProjectUtils {
  /**
   * Log debug messages if debug mode is enabled
   */
  private static logDebug(message: string): void {
    if (process.env.DEBUG === 'true') {
      console.debug(`[PROJECT-UTILS] ${message}`);
    }
  }

  /**
   * Validate a path to prevent path traversal attacks
   */
  static validatePath(path: string): boolean {
    // Basic validation to prevent path traversal
    if (!path || path.includes('..')) {
      return false;
    }

    // Add more validation as needed
    return true;
  }

  /**
   * Check if a directory is a valid Godot project
   */
  static isValidGodotProject(projectPath: string): boolean {
    const projectFile = join(projectPath, 'project.godot');
    return existsSync(projectFile);
  }

  /**
   * Get the structure of a Godot project
   */
  static getProjectStructure(projectPath: string): ProjectStructure {
    try {
      // Get top-level directories in the project
      const entries = readdirSync(projectPath, { withFileTypes: true });

      const structure: ProjectStructure = {
        scenes: 0,
        scripts: 0,
        assets: 0,
        other: 0,
      };

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();

          // Skip hidden directories
          if (dirName.startsWith('.')) {
            continue;
          }

          // Count files in common directories
          if (dirName === 'scenes' || dirName.includes('scene')) {
            structure.scenes++;
          } else if (dirName === 'scripts' || dirName.includes('script')) {
            structure.scripts++;
          } else if (
            dirName === 'assets' ||
            dirName === 'textures' ||
            dirName === 'models' ||
            dirName === 'sounds' ||
            dirName === 'music'
          ) {
            structure.assets++;
          } else {
            structure.other++;
          }
        }
      }

      return structure;
    } catch (error) {
      ProjectUtils.logDebug(`Error getting project structure: ${error}`);
      return {
        error: 'Failed to get project structure',
        scenes: 0,
        scripts: 0,
        assets: 0,
        other: 0
      };
    }
  }

  /**
   * Get the structure of a Godot project asynchronously by counting files recursively
   */
  static async getProjectStructureAsync(projectPath: string): Promise<ProjectStructure> {
    return new Promise((resolve) => {
      try {
        const structure: ProjectStructure = {
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0,
        };

        const scanDirectory = (currentPath: string) => {
          const entries = readdirSync(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);

            // Skip hidden files and directories
            if (entry.name.startsWith('.')) {
              continue;
            }

            if (entry.isDirectory()) {
              // Recursively scan subdirectories
              scanDirectory(entryPath);
            } else if (entry.isFile()) {
              // Count file by extension
              const ext = entry.name.split('.').pop()?.toLowerCase();

              if (ext === 'tscn') {
                structure.scenes++;
              } else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
                structure.scripts++;
              } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')) {
                structure.assets++;
              } else {
                structure.other++;
              }
            }
          }
        };

        // Start scanning from the project root
        scanDirectory(projectPath);
        resolve(structure);
      } catch (error) {
        ProjectUtils.logDebug(`Error getting project structure asynchronously: ${error}`);
        resolve({
          error: 'Failed to get project structure',
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0
        });
      }
    });
  }

  /**
   * Find Godot projects in a directory
   */
  static findGodotProjects(directory: string, recursive: boolean): GodotProjectRef[] {
    const projects: GodotProjectRef[] = [];

    try {
      // Check if the directory itself is a Godot project
      const projectFile = join(directory, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({
          path: directory,
          name: basename(directory),
        });
      }

      // If not recursive, only check immediate subdirectories
      if (!recursive) {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            }
          }
        }
      } else {
        // Recursive search
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            // Skip hidden directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            // Check if this directory is a Godot project
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            } else {
              // Recursively search this directory
              const subProjects = ProjectUtils.findGodotProjects(subdir, true);
              projects.push(...subProjects);
            }
          }
        }
      }
    } catch (error) {
      ProjectUtils.logDebug(`Error searching directory ${directory}: ${error}`);
    }

    return projects;
  }

  /**
   * Extract project name from project.godot file
   */
  static getProjectName(projectPath: string): string {
    let projectName = basename(projectPath);

    try {
      const fs = require('fs');
      const projectFile = join(projectPath, 'project.godot');
      const projectFileContent = fs.readFileSync(projectFile, 'utf8');
      const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
      if (configNameMatch && configNameMatch[1]) {
        projectName = configNameMatch[1];
        ProjectUtils.logDebug(`Found project name in config: ${projectName}`);
      }
    } catch (error) {
      ProjectUtils.logDebug(`Error reading project file: ${error}`);
      // Continue with default project name if extraction fails
    }

    return projectName;
  }

  /**
   * Check if the Godot version is 4.4 or later
   */
  static isGodot44OrLater(version: string): boolean {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      return major > 4 || (major === 4 && minor >= 4);
    }
    return false;
  }
}