import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { GodotServer } from './godot-server.js';

const hasGodot = Boolean(process.env.GODOT_PATH);
const repoRoot = process.cwd();
const scratchFixturePath = resolve(repoRoot, '.tmp', 'runtime-control-fixture');
const fixtureMainScenePath = join(scratchFixturePath, 'Main.tscn');
const fixtureButtonPath = '/root/Main/RuntimeTestButton';
const fixtureTargetScenePath = 'res://Level1.tscn';

type RuntimeFlowFixtureResult = {
  bridgeInstalled: boolean;
  connected: boolean;
  findNode: {
    nodeType: string;
  };
  invokeNodeAction: {
    ok: boolean;
  };
  changeScene: {
    ok: boolean;
  };
};

type ToolCallResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
};

type RuntimeStateResponse = {
  connected: boolean;
  sessionId: string | null;
  scenePath: string | null;
};

type FindNodeResponse = {
  ok: boolean;
  error?: string;
  result?: {
    found?: boolean;
    nodePath?: string;
    nodeType?: string;
  };
};

type RuntimeActionResponse = {
  ok: boolean;
  error?: string;
  result?: {
    nodePath?: string;
    action?: string;
    scenePath?: string;
  };
};

function resolveSampleProjectPath(): string {
  const candidatePaths = [
    resolve(repoRoot, 'tilemap-test-project'),
    resolve(repoRoot, '..', 'tilemap-test-project'),
    resolve(repoRoot, '..', '..', 'tilemap-test-project'),
  ];

  const samplePath = candidatePaths.find((candidatePath) => existsSync(join(candidatePath, 'project.godot')));
  if (!samplePath) {
    throw new Error('Could not locate tilemap-test-project from this checkout.');
  }

  return samplePath;
}

function getTextContent(result: ToolCallResult): string {
  const textContent = result.content
    ?.map((entry) => entry.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n')
    .trim();

  if (!textContent) {
    throw new Error('Tool returned no text content.');
  }

  return textContent;
}

async function withConnectedClient<T>(
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const server = new GodotServer({
    godotPath: process.env.GODOT_PATH,
    strictPathValidation: true,
  });
  const client = new Client(
    {
      name: 'runtime-control-integration-test',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    ((server as any).server).connect(serverTransport),
  ]);

  try {
    return await callback(client);
  } finally {
    await client.close().catch(() => undefined);
    await ((server as any).cleanup()).catch(() => undefined);
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
  return client.callTool({
    name,
    arguments: args,
  }) as Promise<ToolCallResult>;
}

async function callJsonTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const result = await callTool(client, name, args);
  const textContent = getTextContent(result);

  if (result.isError) {
    throw new Error(textContent);
  }

  return JSON.parse(textContent) as T;
}

async function prepareFixtureProject(): Promise<void> {
  const sampleProjectPath = resolveSampleProjectPath();
  await rm(scratchFixturePath, { recursive: true, force: true });
  await mkdir(dirname(scratchFixturePath), { recursive: true });
  await cp(sampleProjectPath, scratchFixturePath, { recursive: true, force: true });
  await injectFixtureButton();
}

async function injectFixtureButton(): Promise<void> {
  const mainScene = await readFile(fixtureMainScenePath, 'utf8');
  const buttonBlock = [
    '',
    '[node name="RuntimeTestButton" type="Button" parent="."]',
    'text = "Runtime Control"',
    '',
  ].join('\n');

  if (mainScene.includes('[node name="RuntimeTestButton" type="Button" parent="."]')) {
    return;
  }

  await writeFile(fixtureMainScenePath, `${mainScene.trimEnd()}\n${buttonBlock}`, 'utf8');
}

async function runRuntimeFlowFixture(): Promise<RuntimeFlowFixtureResult> {
  try {
    await prepareFixtureProject();

    return await withConnectedClient(async (client) => {
      const bridgeStatus = await callJsonTool<{ installed: boolean }>(
        client,
        'install_runtime_bridge',
        { projectPath: scratchFixturePath }
      );

      const runResult = await callTool(client, 'run_project', {
        projectPath: scratchFixturePath,
        runtimeControl: true,
      });

      if (runResult.isError) {
        throw new Error(getTextContent(runResult));
      }

      let runtimeState: RuntimeStateResponse = {
        connected: false,
        sessionId: null,
        scenePath: null,
      };
      await vi.waitFor(async () => {
        runtimeState = await callJsonTool<RuntimeStateResponse>(client, 'get_runtime_state');
        expect(runtimeState.connected).toBe(true);
      }, {
        timeout: 60000,
        interval: 500,
      });

      const findNodeResponse = await callJsonTool<FindNodeResponse>(client, 'find_node', {
        nodePath: fixtureButtonPath,
      });
      if (findNodeResponse.ok !== true || !findNodeResponse.result?.nodeType) {
        throw new Error(findNodeResponse.error ?? 'find_node did not return a node type.');
      }

      const invokeNodeAction = await callJsonTool<RuntimeActionResponse>(client, 'invoke_node_action', {
        nodePath: fixtureButtonPath,
        action: 'press',
      });
      if (invokeNodeAction.ok !== true) {
        throw new Error(invokeNodeAction.error ?? 'invoke_node_action did not succeed.');
      }

      const changeScene = await callJsonTool<RuntimeActionResponse>(client, 'change_scene', {
        scenePath: fixtureTargetScenePath,
      });

      const stopResult = await callTool(client, 'stop_project');
      if (stopResult.isError) {
        throw new Error(getTextContent(stopResult));
      }

      return {
        bridgeInstalled: bridgeStatus.installed,
        connected: runtimeState.connected,
        findNode: {
          nodeType: findNodeResponse.result.nodeType,
        },
        invokeNodeAction: {
          ok: invokeNodeAction.ok,
        },
        changeScene: {
          ok: changeScene.ok,
        },
      };
    });
  } finally {
    await rm(scratchFixturePath, { recursive: true, force: true });
  }
}

describe.skipIf(!hasGodot)('runtime control integration', () => {
  it('installs the bridge and controls the sample project end-to-end', async () => {
    const result = await runRuntimeFlowFixture();
    expect(result.bridgeInstalled).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.findNode.nodeType).toBe('Button');
    expect(result.changeScene.ok).toBe(true);
  }, 120000);
});
