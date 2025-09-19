#!/usr/bin/env node
/**
 * Godot MCP Server
 *
 * This MCP server provides tools for interacting with the Godot game engine.
 * It enables AI assistants to launch the Godot editor, run Godot projects,
 * capture debug output, and control project execution.
 */

import { GodotServer } from './godot-server.js';
import { GodotServerConfig } from './types.js';

type ConfigInput = Partial<Record<keyof GodotServerConfig, unknown>>;

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
  }

  return undefined;
}

function mergeConfig(current: GodotServerConfig, input: ConfigInput): {
  next: GodotServerConfig;
  changed: boolean;
} {
  let changed = false;
  const next: GodotServerConfig = { ...current };

  const pathValue = input.godotPath;
  if (typeof pathValue === 'string') {
    const trimmed = pathValue.trim();
    if (trimmed === '') {
      if (current.godotPath !== undefined) {
        next.godotPath = undefined;
        changed = true;
      }
    } else if (current.godotPath !== trimmed) {
      next.godotPath = trimmed;
      changed = true;
    }
  } else if (pathValue === null && current.godotPath !== undefined) {
    next.godotPath = undefined;
    changed = true;
  }

  const booleanKeys: Array<keyof Pick<GodotServerConfig, 'debugMode' | 'godotDebugMode' | 'strictPathValidation'>> = [
    'debugMode',
    'godotDebugMode',
    'strictPathValidation',
  ];

  for (const key of booleanKeys) {
    if (input[key] !== undefined) {
      const coerced = parseBoolean(input[key]);
      if (coerced !== undefined && current[key] !== coerced) {
        next[key] = coerced;
        changed = true;
      }
    }
  }

  return { next, changed };
}

function parseJsonConfig(raw: string): ConfigInput {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object');
    }
    return parsed as ConfigInput;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[GODOT-SERVER] Failed to parse argument config: ${message}`);
    process.exit(1);
  }
}

function parseArgumentConfig(argv: string[]): GodotServerConfig | undefined {
  let config: GodotServerConfig = {};
  let applied = false;

  const apply = (input: ConfigInput) => {
    const { next, changed } = mergeConfig(config, input);
    config = next;
    applied = applied || changed;
  };

  const envCandidates = [
    process.env.MCP_ARGUMENT_CONFIG,
    process.env.MCP_SERVER_ARGUMENT_CONFIG,
    process.env.MCP_CONFIG,
  ];

  for (const candidate of envCandidates) {
    if (candidate && candidate.trim() !== '') {
      apply(parseJsonConfig(candidate));
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const readValue = (value?: string): string => {
      if (value && value !== '') {
        return value;
      }
      const nextValue = argv[index + 1];
      if (!nextValue) {
        console.error(`[GODOT-SERVER] Missing value for argument ${arg}`);
        process.exit(1);
      }
      index += 1;
      return nextValue;
    };

    if (arg === '--godot-path' || arg === '--godotPath') {
      apply({ godotPath: readValue() });
      continue;
    }

    if (arg.startsWith('--godot-path=')) {
      apply({ godotPath: readValue(arg.slice('--godot-path='.length)) });
      continue;
    }

    if (arg.startsWith('--godotPath=')) {
      apply({ godotPath: readValue(arg.slice('--godotPath='.length)) });
      continue;
    }

    if (arg === '--config' || arg === '--argument-config' || arg === '--argumentConfig') {
      apply(parseJsonConfig(readValue()));
      continue;
    }

    if (arg.startsWith('--config=')) {
      apply(parseJsonConfig(readValue(arg.slice('--config='.length))));
      continue;
    }

    if (arg.startsWith('--argument-config=')) {
      apply(parseJsonConfig(readValue(arg.slice('--argument-config='.length))));
      continue;
    }

    if (arg.startsWith('--argumentConfig=')) {
      apply(parseJsonConfig(readValue(arg.slice('--argumentConfig='.length))));
    }
  }

  return applied ? config : undefined;
}

// Create and run the server
const argumentConfig = parseArgumentConfig(process.argv.slice(2));
const server = new GodotServer(argumentConfig);
server.run().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Failed to run server:', errorMessage);
  process.exit(1);
});
