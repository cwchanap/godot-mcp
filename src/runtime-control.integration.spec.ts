import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { GodotServer } from './godot-server.js';

const execFileAsync = promisify(execFile);

const hasGodot = Boolean(process.env.GODOT_PATH) && Boolean(process.env.GODOT_RUNTIME_INTEGRATION_TEST);
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
  capture: {
    mimeType: string;
    width: number;
    height: number;
    byteLength: number;
    pixel: {
      r: number;
      g: number;
      b: number;
    };
    concurrentResponses: Array<{
      ok?: boolean;
      error?: string;
    }>;
    retryResponse: {
      ok?: boolean;
      error?: string;
    };
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
  callback: (client: Client, server: GodotServer) => Promise<T>
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
    return await callback(client, server);
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
  await injectFixtureScene();
  await writeFile(join(scratchFixturePath, 'VerifyCapture.gd'), [
    'extends SceneTree',
    '',
    'func _initialize() -> void:',
    '    var args := OS.get_cmdline_user_args()',
    '    if args.is_empty():',
    '        printerr("Capture path is required")',
    '        quit(1)',
    '        return',
    '    var image := Image.load_from_file(args[0])',
    '    if image == null or image.is_empty():',
    '        printerr("Capture could not be decoded")',
    '        quit(1)',
    '        return',
    '    var pixel := image.get_pixel(1000, 600)',
    '    print(JSON.stringify({',
    '        "width": image.get_width(),',
    '        "height": image.get_height(),',
    '        "r": pixel.r,',
    '        "g": pixel.g,',
    '        "b": pixel.b,',
    '    }))',
    '    quit(0)',
    '',
  ].join('\n'), 'utf8');
}

async function injectFixtureScene(): Promise<void> {
  let mainScene = await readFile(fixtureMainScenePath, 'utf8');
  if (!mainScene.includes('get_viewport().use_hdr_2d = true')) {
    mainScene = mainScene.replace(
      'func _ready():\n',
      'func _ready():\n\tget_viewport().use_hdr_2d = true\n'
    );
  }

  const backgroundBlock = [
    '',
    '[node name="CaptureBackground" type="ColorRect" parent="."]',
    'offset_right = 1280.0',
    'offset_bottom = 720.0',
    'color = Color(0.537, 0.735, 0.881, 1)',
    'mouse_filter = 2',
    'show_behind_parent = true',
    '',
  ].join('\n');
  const buttonBlock = [
    '',
    '[node name="RuntimeTestButton" type="Button" parent="."]',
    'text = "Runtime Control"',
    '',
  ].join('\n');

  if (!mainScene.includes('[node name="CaptureBackground" type="ColorRect" parent="."]')) {
    mainScene = `${mainScene.trimEnd()}\n${backgroundBlock}`;
  }
  if (!mainScene.includes('[node name="RuntimeTestButton" type="Button" parent="."]')) {
    mainScene = `${mainScene.trimEnd()}\n${buttonBlock}`;
  }

  await writeFile(fixtureMainScenePath, `${mainScene.trimEnd()}\n`, 'utf8');
}

async function runRuntimeFlowFixture(): Promise<RuntimeFlowFixtureResult> {
  try {
    await prepareFixtureProject();

    return await withConnectedClient(async (client, server) => {
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

      const capture = await (server as any).runtimeControlManager.captureScreenshot();
      const capturePath = join(scratchFixturePath, 'runtime-capture.png');
      await writeFile(capturePath, Buffer.from(capture.data, 'base64'));
      const { stdout } = await execFileAsync(process.env.GODOT_PATH as string, [
        '--headless',
        '--path',
        scratchFixturePath,
        '--script',
        'res://VerifyCapture.gd',
        '--',
        capturePath,
      ]);
      const verifierOutput = stdout.trim().split(/\r?\n/).at(-1);
      if (!verifierOutput) {
        throw new Error('Capture verifier returned no JSON output.');
      }
      const pixel = JSON.parse(verifierOutput) as {
        width: number;
        height: number;
        r: number;
        g: number;
        b: number;
      };

      expect(capture.mimeType).toBe('image/png');
      expect(capture.width).toBe(1280);
      expect(capture.height).toBe(720);
      expect(pixel.width).toBe(1280);
      expect(pixel.height).toBe(720);
      expect(pixel.r).toBeCloseTo(0.537, 2);
      expect(pixel.g).toBeCloseTo(0.735, 2);
      expect(pixel.b).toBeCloseTo(0.881, 2);

      const runtimeManager = (server as any).runtimeControlManager;
      const concurrentResponses = await Promise.all([
        runtimeManager.sendCommandOverSocket({ command: 'capture_screenshot' }),
        runtimeManager.sendCommandOverSocket({ command: 'capture_screenshot' }),
      ]) as Array<{ ok?: boolean; error?: string }>;
      expect(concurrentResponses.filter((response) => response.ok === true)).toHaveLength(1);
      expect(concurrentResponses.filter(
        (response) => response.error === 'Screenshot capture already in progress'
      )).toHaveLength(1);
      const retryResponse = await runtimeManager.sendCommandOverSocket({
        command: 'capture_screenshot',
      }) as { ok?: boolean; error?: string };
      expect(retryResponse.ok).toBe(true);

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
        capture: {
          mimeType: capture.mimeType,
          width: capture.width,
          height: capture.height,
          byteLength: capture.byteLength,
          pixel,
          concurrentResponses,
          retryResponse,
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
    expect(result.capture.mimeType).toBe('image/png');
    expect(result.capture.width).toBe(1280);
    expect(result.capture.height).toBe(720);
  }, 120000);
});
