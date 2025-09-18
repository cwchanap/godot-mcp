/**
 * Tool handlers for the Godot MCP Server
 */

import { join, basename } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { GodotProcess } from './types.js';
import { GodotPathManager } from './godot-path.js';
import { ProjectUtils } from './project-utils.js';
import { OperationExecutor } from './operation-executor.js';

const execAsync = promisify(exec);

interface OperationToolOptions {
  expectsJson?: boolean;
  successMessage?: string;
}

export class ToolHandlers {
  private activeProcess: GodotProcess | null = null;
  private pathManager: GodotPathManager;
  private operationExecutor: OperationExecutor;

  constructor(pathManager: GodotPathManager, operationExecutor: OperationExecutor) {
    this.pathManager = pathManager;
    this.operationExecutor = operationExecutor;
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private logDebug(message: string): void {
    if (process.env.DEBUG === 'true') {
      console.debug(`[TOOL-HANDLERS] ${message}`);
    }
  }

  /**
   * Create a standardized error response with possible solutions
   */
  private createErrorResponse(message: string, possibleSolutions: string[] = []): any {
    // Log the error
    console.error(`[TOOL-HANDLERS] Error response: ${message}`);
    if (possibleSolutions.length > 0) {
      console.error(`[TOOL-HANDLERS] Possible solutions: ${possibleSolutions.join(', ')}`);
    }

    const response: any = {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };

    if (possibleSolutions.length > 0) {
      response.content.push({
        type: 'text',
        text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- '),
      });
    }

    return response;
  }

  private extractJsonFromOutput(output: string): any {
    const trimmed = (output ?? '').trim();
    if (!trimmed) {
      throw new Error('No JSON content returned from Godot');
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      try {
        return JSON.parse(line);
      } catch (error) {
        this.logDebug(`Failed to parse JSON line: ${line}`);
      }
    }

    throw new Error('Unable to parse JSON content from Godot output');
  }

  /**
   * Clean up resources when shutting down
   */
  async cleanup(): Promise<void> {
    this.logDebug('Cleaning up resources');
    if (this.activeProcess) {
      this.logDebug('Killing active Godot process');
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
  }

  /**
   * Handle the launch_editor tool
   */
  async handleLaunchEditor(args: any) {
    // Normalize parameters to camelCase
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!ProjectUtils.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        await this.pathManager.detectGodotPath();
        const newPath = this.pathManager.getPath();
        if (!newPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      this.logDebug(`Launching Godot editor for project: ${args.projectPath}`);
      const process = spawn(this.pathManager.getPath()!, ['-e', '--path', args.projectPath], {
        stdio: 'pipe',
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot editor:', err);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Godot editor launched successfully for project at ${args.projectPath}.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to launch Godot editor: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the run_project tool
   */
  async handleRunProject(args: any) {
    // Normalize parameters to camelCase
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!ProjectUtils.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Kill any existing process
      if (this.activeProcess) {
        this.logDebug('Killing existing Godot process before starting a new one');
        this.activeProcess.process.kill();
      }

      const cmdArgs = ['-d', '--path', args.projectPath];
      if (args.scene && ProjectUtils.validatePath(args.scene)) {
        this.logDebug(`Adding scene parameter: ${args.scene}`);
        cmdArgs.push(args.scene);
      }

      this.logDebug(`Running Godot project: ${args.projectPath}`);
      const process = spawn(this.pathManager.getPath()!, cmdArgs, { stdio: 'pipe' });
      const output: string[] = [];
      const errors: string[] = [];

      process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        output.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stdout] ${line}`);
        });
      });

      process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        errors.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stderr] ${line}`);
        });
      });

      process.on('exit', (code: number | null) => {
        this.logDebug(`Godot process exited with code ${code}`);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot process:', err);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      this.activeProcess = { process, output, errors };

      return {
        content: [
          {
            type: 'text',
            text: `Godot project started in debug mode. Use get_debug_output to see output.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to run Godot project: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the get_debug_output tool
   */
  async handleGetDebugOutput() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process.',
        [
          'Use run_project to start a Godot project first',
          'Check if the Godot process crashed unexpectedly',
        ]
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              output: this.activeProcess.output,
              errors: this.activeProcess.errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the stop_project tool
   */
  async handleStopProject() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process to stop.',
        [
          'Use run_project to start a Godot project first',
          'The process may have already terminated',
        ]
      );
    }

    this.logDebug('Stopping active Godot process');
    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'Godot project stopped',
              finalOutput: output,
              finalErrors: errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the get_godot_version tool
   */
  async handleGetGodotVersion() {
    try {
      // Ensure godotPath is set
      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        await this.pathManager.detectGodotPath();
        const newPath = this.pathManager.getPath();
        if (!newPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      this.logDebug('Getting Godot version');
      const { stdout } = await execAsync(`"${this.pathManager.getPath()}" --version`);
      return {
        content: [
          {
            type: 'text',
            text: stdout.trim(),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to get Godot version: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]
      );
    }
  }

  /**
   * Handle the list_projects tool
   */
  async handleListProjects(args: any) {
    // Normalize parameters to camelCase
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.directory) {
      return this.createErrorResponse(
        'Directory is required',
        ['Provide a valid directory path to search for Godot projects']
      );
    }

    if (!ProjectUtils.validatePath(args.directory)) {
      return this.createErrorResponse(
        'Invalid directory path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      this.logDebug(`Listing Godot projects in directory: ${args.directory}`);
      if (!existsSync(args.directory)) {
        return this.createErrorResponse(
          `Directory does not exist: ${args.directory}`,
          ['Provide a valid directory path that exists on the system']
        );
      }

      const recursive = args.recursive === true;
      const projects = ProjectUtils.findGodotProjects(args.directory, recursive);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list projects: ${error?.message || 'Unknown error'}`,
        [
          'Ensure the directory exists and is accessible',
          'Check if you have permission to read the directory',
        ]
      );
    }
  }

  /**
   * Handle the get_project_info tool
   */
  async handleGetProjectInfo(args: any) {
    // Normalize parameters to camelCase
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!ProjectUtils.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        await this.pathManager.detectGodotPath();
        const newPath = this.pathManager.getPath();
        if (!newPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      this.logDebug(`Getting project info for: ${args.projectPath}`);

      // Get Godot version
      const execOptions = { timeout: 10000 }; // 10 second timeout
      const { stdout } = await execAsync(`"${this.pathManager.getPath()}" --version`, execOptions);

      // Get project structure using the recursive method
      const projectStructure = await ProjectUtils.getProjectStructureAsync(args.projectPath);

      // Extract project name from project.godot file
      const projectName = ProjectUtils.getProjectName(args.projectPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: projectName,
                path: args.projectPath,
                godotVersion: stdout.trim(),
                structure: projectStructure,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project info: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  // Operation-based handlers that use the operation executor

  /**
   * Handle the create_scene tool
   */
  async handleCreateScene(args: any) {
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Project path and scene path are required',
        ['Provide valid paths for both the project and the scene']
      );
    }

    if (!ProjectUtils.validatePath(args.projectPath) || !ProjectUtils.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      const params = {
        scenePath: args.scenePath,
        rootNodeType: args.rootNodeType || 'Node2D',
      };

      const { stdout, stderr } = await this.operationExecutor.executeOperation('create_scene', params, args.projectPath, this.pathManager);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to create scene: ${stderr}`,
          [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Scene created successfully at: ${args.scenePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the add_node tool
   */
  async handleAddNode(args: any) {
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodeType, and nodeName']
      );
    }

    if (!ProjectUtils.validatePath(args.projectPath) || !ProjectUtils.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      const params: any = {
        scenePath: args.scenePath,
        nodeType: args.nodeType,
        nodeName: args.nodeName,
      };

      if (args.parentNodePath) {
        params.parentNodePath = args.parentNodePath;
      }

      if (args.properties) {
        params.properties = args.properties;
      }

      const { stdout, stderr } = await this.operationExecutor.executeOperation('add_node', params, args.projectPath, this.pathManager);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to add node: ${stderr}`,
          [
            'Check if the node type is valid',
            'Ensure the parent node path exists',
            'Verify the scene file is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Node '${args.nodeName}' of type '${args.nodeType}' added successfully to '${args.scenePath}'.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add node: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  // Additional operation-based handlers would follow the same pattern...
  // For brevity, I'll implement a few key ones and add a method to handle the rest

  /**
   * Handle operation-based tools generically
   */
  async handleOperationTool(
    toolName: string,
    operation: string,
    args: any,
    requiredParams: string[],
    options: OperationToolOptions = {}
  ) {
    args = this.operationExecutor.normalizeParameters(args);

    // Check required parameters
    const missingParams = requiredParams.filter(param => !args[param]);
    if (missingParams.length > 0) {
      return this.createErrorResponse(
        `Missing required parameters: ${missingParams.join(', ')}`,
        [`Provide ${missingParams.join(', ')}`]
      );
    }

    // Validate paths
    const pathParams = Object.keys(args).filter(param => param.toLowerCase().includes('path'));
    const invalidPaths = pathParams.filter(param => {
      const value = args[param];
      return typeof value === 'string' && !ProjectUtils.validatePath(value);
    });
    if (invalidPaths.length > 0) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      if (args.projectPath && !ProjectUtils.isValidGodotProject(args.projectPath)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Prepare parameters (remove projectPath as it's used for execution context)
      const { projectPath, ...params } = args;

      const { stdout, stderr } = await this.operationExecutor.executeOperation(operation, params, projectPath, this.pathManager);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to ${toolName}: ${stderr}`,
          [
            'Check the operation parameters',
            'Verify file paths are correct',
            'Ensure proper permissions',
          ]
        );
      }

      if (options.expectsJson) {
        try {
          const json = this.extractJsonFromOutput(stdout);
          return {
            content: [
              {
                type: 'text',
                text: options.successMessage || `${toolName} completed successfully.`,
              },
              {
                type: 'text',
                text: JSON.stringify(json, null, 2),
              },
            ],
          };
        } catch (error) {
          this.logDebug(
            `Failed to parse JSON output for operation '${operation}': ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          this.logDebug(`Raw stdout: ${stdout}`);
          return this.createErrorResponse(
            `Failed to ${toolName}: Unable to parse JSON output`,
            [
              'Run with DEBUG=true for verbose logging',
              'Verify the requested resource exists and is readable',
            ]
          );
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `${toolName} completed successfully.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to ${toolName}: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  // Additional specific handlers using the generic handler
  async handleLoadSprite(args: any) {
    return this.handleOperationTool('load sprite', 'load_sprite', args, ['projectPath', 'scenePath', 'nodePath', 'texturePath']);
  }

  async handleExportMeshLibrary(args: any) {
    return this.handleOperationTool('export mesh library', 'export_mesh_library', args, ['projectPath', 'scenePath', 'outputPath']);
  }

  async handleSaveScene(args: any) {
    return this.handleOperationTool('save scene', 'save_scene', args, ['projectPath', 'scenePath']);
  }

  async handleGetUid(args: any) {
    args = this.operationExecutor.normalizeParameters(args);

    if (!args.projectPath || !args.filePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and filePath']
      );
    }

    try {
      // Check Godot version first
      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        await this.pathManager.detectGodotPath();
      }

      const { stdout: versionOutput } = await execAsync(`"${this.pathManager.getPath()}" --version`);
      const version = versionOutput.trim();

      if (!ProjectUtils.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      return this.handleOperationTool('get UID', 'get_uid', args, ['projectPath', 'filePath']);
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get UID: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]
      );
    }
  }

  async handleUpdateProjectUids(args: any) {
    args = this.operationExecutor.normalizeParameters(args);

    try {
      // Check Godot version first
      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        await this.pathManager.detectGodotPath();
      }

      const { stdout: versionOutput } = await execAsync(`"${this.pathManager.getPath()}" --version`);
      const version = versionOutput.trim();

      if (!ProjectUtils.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      return this.handleOperationTool('update project UIDs', 'resave_resources', args, ['projectPath']);
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to update project UIDs: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]
      );
    }
  }

  async handleCreateTilemap(args: any) {
    return this.handleOperationTool('create TileMap', 'create_tilemap', args, ['projectPath', 'scenePath', 'tilemapName']);
  }

  async handleCreateTileset(args: any) {
    return this.handleOperationTool('create TileSet', 'create_tileset', args, ['projectPath', 'tilesetPath']);
  }

  async handleSetTilemapSource(args: any) {
    return this.handleOperationTool('set TileMap source', 'set_tilemap_source', args, ['projectPath', 'scenePath', 'tilemapPath', 'tilesetPath']);
  }

  async handlePaintTiles(args: any) {
    return this.handleOperationTool('paint tiles', 'paint_tiles', args, ['projectPath', 'scenePath', 'tilemapPath', 'tiles']);
  }

  async handleAddTilesetSource(args: any) {
    return this.handleOperationTool('add TileSet source', 'add_tileset_source', args, ['projectPath', 'tilesetPath', 'texturePath']);
  }

  async handleReadTilemap(args: any) {
    return this.handleOperationTool(
      'read TileMap',
      'read_tilemap',
      args,
      ['projectPath', 'scenePath'],
      {
        expectsJson: true,
        successMessage: 'TileMap data retrieved successfully.',
      }
    );
  }

  async handleReadTileset(args: any) {
    return this.handleOperationTool(
      'read TileSet',
      'read_tileset',
      args,
      ['projectPath', 'tilesetPath'],
      {
        expectsJson: true,
        successMessage: 'TileSet data retrieved successfully.',
      }
    );
  }
}
