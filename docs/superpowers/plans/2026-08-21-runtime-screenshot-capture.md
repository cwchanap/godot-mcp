# Runtime Screenshot Capture Implementation Plan

> **v0.1.3 correction:** The completed implementation no longer waits for `RenderingServer.frame_post_draw`. Screenshot capture reads the latest available root-viewport frame after one engine process tick, so paused or non-presenting render loops cannot leave the bridge capture guard locked. The next-frame instructions and snippets below are retained as historical implementation-plan context and are superseded by the design spec.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `capture_screenshot` MCP tool that returns the active Godot game's next rendered root-viewport frame as PNG and optionally persists it to a managed temporary or project directory.

**Architecture:** Extend the existing authenticated NDJSON runtime bridge with one async `capture_screenshot` command. Godot owns frame readback and PNG encoding; TypeScript bounds and validates the response, owns optional persistence, and maps the result to MCP text plus `ImageContent`.

**Tech Stack:** TypeScript 5.3, Node.js 18 `net`/`fs` APIs, MCP SDK 0.6.0, Vitest 3, Godot 4 GDScript and `StreamPeerTCP`

**Spec:** `docs/superpowers/specs/2026-08-21-runtime-screenshot-capture-design.md`

## Global Constraints

- Tool input is exactly `capture_screenshot({ saveTo?: "temporary" | "project" })`; `save_to` must normalize to `saveTo`.
- Always return a lossless `image/png` at native root-viewport resolution; no editor window, OS screenshot, `SubViewport`, alternate format, crop, or resize support.
- Limit decoded PNG data to 16 MiB and any complete or buffered NDJSON message to 24 MiB.
- Enforce one in-flight capture in both TypeScript and GDScript; do not queue captures.
- Await `RenderingServer.frame_post_draw` and normalize HDR 2D output from linear color to sRGB `RGBA8` before PNG encoding.
- A screenshot timeout must clear capture state without marking a live bridge disconnected; socket close remains authoritative for disconnect state.
- MCP success content is exactly metadata text followed by `{ type: "image", data, mimeType: "image/png" }`.
- A persistence failure returns the valid image with `savedPath: null` and `saveError`; it does not set `isError`.
- Project persistence is fixed at `<active-project>/.godot-mcp/captures/`, creates `.godot-mcp/.gdignore`, rejects symlink escape, and never overwrites.
- Temporary persistence uses one per-process directory and is removed through the existing shutdown cleanup chain.
- Add no runtime dependencies and no second transport, chunking, caller-controlled path, or filename.
- Bump package, server, and generated bridge compatibility from `0.1.1` to `0.1.2`.
- Preserve all existing runtime tool contracts and their current reconnect behavior.

---

## File Structure

### Create

- `src/screenshot-payload.ts` — pure constants, payload types, and PNG response validation.
- `src/screenshot-payload.spec.ts` — table-driven validation tests independent of sockets.
- `src/test-helpers/png-fixture.ts` — creates valid small and near-limit PNG byte buffers for transport tests without a new dependency.
- `docs/superpowers/plans/2026-08-21-runtime-screenshot-capture.md` — this implementation plan.

### Modify

- `src/runtime-control-manager.ts` — capture command routing, timeout policy, receive bounds, in-flight guard, persistence, and temporary cleanup.
- `src/runtime-control-manager.spec.ts` — real-socket round trips, near-limit payload, timeout recovery, receive cap, persistence, and cleanup.
- `src/scripts/runtime_bridge.gd` — async command dispatcher, frame capture, bridge-side in-flight guard, PNG encoding, and checked full-buffer write.
- `src/runtime-control.integration.spec.ts` — known-color rendered-frame and bridge concurrency verification against Godot.
- `src/types.ts` — screenshot result/save destination types and `save_to` normalization.
- `src/tool-handlers.ts` — screenshot handler, MCP image mapping, error mapping, and manager cleanup.
- `src/godot-server.ts` — screenshot tool schema, dispatch, runtime manager interface, and server version.
- `src/tool-handlers.runtime.spec.ts` — registration, dispatch, handler result/error, normalization, cleanup, and server metadata tests.
- `package.json` — patch version.
- `package-lock.json` — lockfile package version entries.
- `README.md` — feature, setup, examples, limit, bridge-update note, and `autoApprove` entry.
- `CONTRIBUTING.md` — replace the stale caller-path screenshot contract.

---

### Task 1: Build the bounded TypeScript screenshot transport

**Files:**
- Create: `src/screenshot-payload.ts`
- Create: `src/screenshot-payload.spec.ts`
- Create: `src/test-helpers/png-fixture.ts`
- Modify: `src/types.ts:34-55,86-115`
- Modify: `src/runtime-control-manager.ts:26-95,223-243,475-550,612-675`
- Test: `src/runtime-control-manager.spec.ts:270-465`

**Interfaces:**
- Consumes: existing request-ID correlation in `sendCommandOverSocket()` and existing connected-session state.
- Produces: `MAX_SCREENSHOT_PNG_BYTES`, `MAX_SCREENSHOT_BASE64_CHARS`, `MAX_RUNTIME_MESSAGE_BYTES`, `validateScreenshotPayload(payload)`, `ScreenshotSaveDestination`, `ScreenshotCaptureResult`, and `RuntimeControlManager.captureScreenshot(saveTo?)`.

- [ ] **Step 1: Add a dependency-free valid PNG fixture helper**

Create `src/test-helpers/png-fixture.ts` with a known valid 1×1 PNG and a CRC-correct ancillary chunk for near-limit transport tests:

```ts
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.allocUnsafe(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

export function createOnePixelPng(): Buffer {
  return Buffer.from(ONE_PIXEL_PNG);
}

export function createNearLimitPng(targetBytes: number): Buffer {
  const iendOffset = ONE_PIXEL_PNG.length - 12;
  const ancillaryLength = targetBytes - ONE_PIXEL_PNG.length - 12;
  if (ancillaryLength < 0) {
    throw new Error('Target PNG size is too small.');
  }
  const ancillary = createChunk('npAD', Buffer.alloc(ancillaryLength, 0x5a));
  return Buffer.concat([
    ONE_PIXEL_PNG.subarray(0, iendOffset),
    ancillary,
    ONE_PIXEL_PNG.subarray(iendOffset),
  ]);
}
```

- [ ] **Step 2: Write failing pure payload-validation tests**

Create `src/screenshot-payload.spec.ts` covering one valid payload and each invariant:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_SCREENSHOT_BASE64_CHARS,
  MAX_SCREENSHOT_PNG_BYTES,
  validateScreenshotPayload,
} from './screenshot-payload.js';
import { createNearLimitPng, createOnePixelPng } from './test-helpers/png-fixture.js';

function payloadFor(bytes: Buffer): Record<string, unknown> {
  return {
    pngBase64: bytes.toString('base64'),
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: bytes.length,
  };
}

describe('validateScreenshotPayload', () => {
  it('returns validated PNG bytes and metadata', () => {
    const png = createOnePixelPng();
    const result = validateScreenshotPayload(payloadFor(png));
    expect(result.bytes).toEqual(png);
    expect(result.data).toBe(png.toString('base64'));
    expect(result.mimeType).toBe('image/png');
  });

  it.each([
    ['empty data', { ...payloadFor(createOnePixelPng()), pngBase64: '' }],
    ['wrong MIME type', { ...payloadFor(createOnePixelPng()), mimeType: 'image/jpeg' }],
    ['zero width', { ...payloadFor(createOnePixelPng()), width: 0 }],
    ['fractional height', { ...payloadFor(createOnePixelPng()), height: 1.5 }],
    ['wrong byte length', { ...payloadFor(createOnePixelPng()), byteLength: 2 }],
    ['wrong signature', payloadFor(Buffer.from('not a png'))],
  ])('rejects %s', (_name, payload) => {
    expect(() => validateScreenshotPayload(payload)).toThrow();
  });

  it('rejects PNG data above 16 MiB', () => {
    const png = createNearLimitPng(MAX_SCREENSHOT_PNG_BYTES + 1);
    expect(() => validateScreenshotPayload(payloadFor(png))).toThrow(/16 MiB/);
  });

  it('rejects encoded data that cannot fit a 16 MiB PNG', () => {
    const payload = payloadFor(createOnePixelPng());
    payload.pngBase64 = 'A'.repeat(MAX_SCREENSHOT_BASE64_CHARS + 4);
    expect(() => validateScreenshotPayload(payload)).toThrow(/encoded screenshot/i);
  });
});
```

- [ ] **Step 3: Run the validator test and observe RED**

Run: `rtk npm run test -- src/screenshot-payload.spec.ts`

Expected: FAIL because `src/screenshot-payload.ts` does not exist.

- [ ] **Step 4: Implement the pure validator and public screenshot types**

Create `src/screenshot-payload.ts`:

```ts
export const SCREENSHOT_MIME_TYPE = 'image/png' as const;
export const MAX_SCREENSHOT_PNG_BYTES = 16 * 1024 * 1024;
export const MAX_SCREENSHOT_BASE64_CHARS = Math.ceil(MAX_SCREENSHOT_PNG_BYTES / 3) * 4;
export const MAX_RUNTIME_MESSAGE_BYTES = 24 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ValidatedScreenshotPayload = {
  data: string;
  bytes: Buffer;
  mimeType: typeof SCREENSHOT_MIME_TYPE;
  width: number;
  height: number;
  byteLength: number;
};

export function validateScreenshotPayload(payload: unknown): ValidatedScreenshotPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid screenshot payload.');
  }
  const value = payload as Record<string, unknown>;
  if (typeof value.pngBase64 !== 'string' || value.pngBase64.length === 0) {
    throw new Error('Screenshot PNG data is required.');
  }
  if (value.pngBase64.length > MAX_SCREENSHOT_BASE64_CHARS) {
    throw new Error('Encoded screenshot data exceeds the 16 MiB PNG limit.');
  }
  if (value.mimeType !== SCREENSHOT_MIME_TYPE) {
    throw new Error('Screenshot MIME type must be image/png.');
  }
  if (!Number.isInteger(value.width) || (value.width as number) <= 0) {
    throw new Error('Screenshot width must be a positive integer.');
  }
  if (!Number.isInteger(value.height) || (value.height as number) <= 0) {
    throw new Error('Screenshot height must be a positive integer.');
  }

  const bytes = Buffer.from(value.pngBase64, 'base64');
  if (bytes.length === 0) {
    throw new Error('Screenshot PNG data could not be decoded.');
  }
  if (bytes.length > MAX_SCREENSHOT_PNG_BYTES) {
    throw new Error('Screenshot PNG exceeds the 16 MiB limit.');
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Screenshot payload does not have a valid PNG signature.');
  }
  if (!Number.isInteger(value.byteLength) || value.byteLength !== bytes.length) {
    throw new Error('Screenshot byte length does not match the decoded PNG.');
  }

  return {
    data: value.pngBase64,
    bytes,
    mimeType: SCREENSHOT_MIME_TYPE,
    width: value.width as number,
    height: value.height as number,
    byteLength: bytes.length,
  };
}
```

Add to `src/types.ts`:

```ts
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
```

- [ ] **Step 5: Run the validator test and observe GREEN**

Run: `rtk npm run test -- src/screenshot-payload.spec.ts`

Expected: PASS for all payload validation cases.

- [ ] **Step 6: Write failing real-socket capture, timeout-recovery, and receive-cap tests**

In `src/runtime-control-manager.spec.ts`, reuse `connectBridgeClient`, `writeJsonLine`, and `readJsonLine`. Add tests that:

```ts
async function connectRealManager(projectPath: string): Promise<{
  manager: RuntimeControlManager;
  socket: Socket;
}> {
  const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
  const session = await manager.startSession(projectPath);
  const socket = await connectBridgeClient(session.port);
  await writeJsonLine(socket, {
    command: 'hello',
    token: session.token,
    version: bridgeVersion,
    sessionId: session.sessionId,
    projectPath,
    scenePath: 'res://Main.tscn',
  });
  await expect(readJsonLine(socket)).resolves.toMatchObject({ ok: true });
  return { manager, socket };
}

it('round-trips a screenshot near the 16 MiB limit over the real socket', async () => {
  const png = createNearLimitPng(MAX_SCREENSHOT_PNG_BYTES - 1024);
  const { manager, socket } = await connectRealManager(projectPath);
  const capture = manager.captureScreenshot();
  const request = await readJsonLine(socket);
  expect(request).toMatchObject({ command: 'capture_screenshot', requestId: expect.any(String) });
  await writeJsonLine(socket, {
    requestId: request.requestId,
    ok: true,
    result: {
      pngBase64: png.toString('base64'),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: png.length,
    },
  });
  await expect(capture).resolves.toMatchObject({
    data: png.toString('base64'),
    byteLength: png.length,
    savedPath: null,
    saveError: null,
  });
  await closeBridgeClient(socket);
  await manager.stopSession();
});

it('keeps the bridge connected after a screenshot timeout and permits retry', async () => {
  vi.useFakeTimers();
  const { manager, socket } = await connectRealManager(projectPath);
  const firstCapture = manager.captureScreenshot();
  await readJsonLine(socket);
  await vi.advanceTimersByTimeAsync(10000);
  await expect(firstCapture).rejects.toThrow(/screenshot capture timed out/i);
  expect(manager.getRuntimeState().connected).toBe(true);

  const png = createOnePixelPng();
  const retry = manager.captureScreenshot();
  const retryRequest = await readJsonLine(socket);
  await writeJsonLine(socket, {
    requestId: retryRequest.requestId,
    ok: true,
    result: {
      pngBase64: png.toString('base64'),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: png.length,
    },
  });
  await expect(retry).resolves.toMatchObject({ byteLength: png.length });
  vi.useRealTimers();
  await closeBridgeClient(socket);
  await manager.stopSession();
});

it('rejects a second capture while the first is in flight and then recovers', async () => {
  const png = createOnePixelPng();
  const { manager, socket } = await connectRealManager(projectPath);
  const first = manager.captureScreenshot();
  const firstRequest = await readJsonLine(socket);
  await expect(manager.captureScreenshot()).rejects.toThrow(/already in progress/i);
  await writeJsonLine(socket, {
    requestId: firstRequest.requestId,
    ok: true,
    result: {
      pngBase64: png.toString('base64'),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: png.length,
    },
  });
  await expect(first).resolves.toMatchObject({ byteLength: png.length });
  await closeBridgeClient(socket);
  await manager.stopSession();
});

it('disconnects a bridge whose unterminated receive buffer exceeds 24 MiB', async () => {
  const { manager, socket } = await connectRealManager(projectPath);
  socket.write(Buffer.alloc(MAX_RUNTIME_MESSAGE_BYTES + 1, 0x61));
  await once(socket, 'close');
  expect(manager.getRuntimeState().connected).toBe(false);
  await manager.stopSession();
});
```

- [ ] **Step 7: Run focused manager tests and observe RED**

Run: `rtk npm run test -- src/runtime-control-manager.spec.ts`

Expected: FAIL because the capture command, in-flight guard, timeout policy, and receive cap are missing.

- [ ] **Step 8: Implement the capture command and bounded receive path**

In `src/runtime-control-manager.ts`:

- Add `{ command: 'capture_screenshot' }` to `RuntimeCommand`.
- Add `private screenshotCaptureInFlight = false`.
- Extract the current connectivity checks from `sendCommand()` into `assertRuntimeConnected()`.
- Keep existing commands routed through the current catch-all `sendCommand()`.
- Route screenshot capture directly through `commandSender` after `assertRuntimeConnected()` so a reply timeout does not call `markDisconnected()`.

Use this public shape:

```ts
async captureScreenshot(saveTo?: ScreenshotSaveDestination): Promise<ScreenshotCaptureResult> {
  this.assertRuntimeConnected();
  if (this.screenshotCaptureInFlight) {
    throw new Error('Screenshot capture already in progress.');
  }
  if (saveTo !== undefined) {
    throw new Error('Screenshot persistence is not available yet.');
  }

  this.screenshotCaptureInFlight = true;
  try {
    const response = await this.commandSender({ command: 'capture_screenshot' }) as {
      ok?: boolean;
      error?: string;
      result?: unknown;
    };
    if (response.ok !== true) {
      throw new Error(response.error ?? 'Screenshot capture failed.');
    }
    const screenshot = validateScreenshotPayload(response.result);
    return {
      data: screenshot.data,
      mimeType: screenshot.mimeType,
      width: screenshot.width,
      height: screenshot.height,
      byteLength: screenshot.byteLength,
      savedPath: null,
      saveError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Screenshot capture failed.';
    if (/timed out/i.test(message)) {
      throw new Error(`Screenshot capture timed out after ${COMMAND_REPLY_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    this.screenshotCaptureInFlight = false;
  }
}
```

In `handleSocketData()`, enforce `MAX_RUNTIME_MESSAGE_BYTES` before JSON parsing for both the accumulated unterminated buffer and each complete `rawMessage`:

```ts
session.receiveBuffer += chunk.toString();
if (
  !session.receiveBuffer.includes('\n') &&
  Buffer.byteLength(session.receiveBuffer, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES
) {
  socket.destroy();
  return;
}

let newlineIndex = session.receiveBuffer.indexOf('\n');
while (newlineIndex !== -1) {
  const rawMessage = session.receiveBuffer.slice(0, newlineIndex).trim();
  session.receiveBuffer = session.receiveBuffer.slice(newlineIndex + 1);
  if (Buffer.byteLength(rawMessage, 'utf8') > MAX_RUNTIME_MESSAGE_BYTES) {
    socket.destroy();
    return;
  }
  if (rawMessage.length > 0) {
    this.parseAndHandleBridgeMessage(session, socket, rawMessage);
  }
  newlineIndex = session.receiveBuffer.indexOf('\n');
}
```

Extract the current JSON parse and `runSocketTask(handleBridgeMessage(...))` body into `parseAndHandleBridgeMessage()` without changing its behavior. After the loop, repeat the unterminated-buffer size check to cover a valid complete message followed by an oversized fragment.

```ts
private parseAndHandleBridgeMessage(
  session: ActiveRuntimeSession,
  socket: Socket,
  rawMessage: string
): void {
  let message: RuntimeBridgeMessage;
  try {
    message = JSON.parse(rawMessage) as RuntimeBridgeMessage;
  } catch {
    this.runSocketTask(this.sendSocketMessage(socket, { ok: false, error: 'Invalid message' }));
    return;
  }
  this.runSocketTask(this.handleBridgeMessage(session, socket, message));
}
```

- [ ] **Step 9: Run focused tests and typecheck**

Run: `rtk npm run test -- src/screenshot-payload.spec.ts src/runtime-control-manager.spec.ts`

Expected: PASS, including the near-limit real-socket round trip and timeout retry.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 10: Commit the bounded transport slice**

```bash
rtk git add src/screenshot-payload.ts src/screenshot-payload.spec.ts src/test-helpers/png-fixture.ts src/types.ts src/runtime-control-manager.ts src/runtime-control-manager.spec.ts
rtk git commit -m "feat: add bounded screenshot transport"
```

---

### Task 2: Capture rendered frames in the GDScript bridge

**Files:**
- Modify: `src/scripts/runtime_bridge.gd:8-16,71-125`
- Modify: `src/runtime-control.integration.spec.ts:1-260`
- Test: `src/runtime-control.integration.spec.ts`

**Interfaces:**
- Consumes: TypeScript `{ command: 'capture_screenshot', requestId }` and the response contract validated in Task 1.
- Produces: one awaited dispatcher, bridge-side capture exclusion, PNG response metadata, and checked full-buffer NDJSON writes.

- [ ] **Step 1: Extend the integration fixture with a known rendered frame**

Update `injectFixtureButton()` into an `injectFixtureScene()` helper that also appends a full-window `ColorRect` behind the existing button and enables HDR 2D in the scene script. Use a midtone linear color so missing sRGB conversion is observable:

```text
[node name="CaptureBackground" type="ColorRect" parent="."]
offset_right = 1280.0
offset_bottom = 720.0
color = Color(0.25, 0.5, 0.75, 1)
mouse_filter = 2
show_behind_parent = true
```

Append `get_viewport().use_hdr_2d = true` inside the fixture root's `_ready()` function before the existing prints.

For this task, access `(server as any).runtimeControlManager.captureScreenshot()` after the existing runtime handshake. Task 4 adds MCP content assertions after the tool is registered.

- [ ] **Step 2: Write the failing rendered-frame and bridge-concurrency integration assertions**

Before `change_scene`, capture a frame and write `Buffer.from(result.data, 'base64')` to the scratch project. Add `VerifyCapture.gd` to the fixture:

```gdscript
extends SceneTree

func _initialize() -> void:
    var args := OS.get_cmdline_user_args()
    if args.is_empty():
        printerr("Capture path is required")
        quit(1)
        return
    var image := Image.load_from_file(args[0])
    if image == null or image.is_empty():
        printerr("Capture could not be decoded")
        quit(1)
        return
    var pixel := image.get_pixel(1000, 600)
    print(JSON.stringify({
        "width": image.get_width(),
        "height": image.get_height(),
        "r": pixel.r,
        "g": pixel.g,
        "b": pixel.b,
    }))
    quit(0)
```

Invoke the same Godot executable and parse the final JSON line:

```ts
const execFileAsync = promisify(execFile);
const capturePath = join(scratchFixturePath, 'runtime-capture.png');
await writeFile(capturePath, Buffer.from(result.data, 'base64'));
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
```

Then assert:

```ts
expect(result.mimeType).toBe('image/png');
expect(result.width).toBe(1280);
expect(result.height).toBe(720);
expect(pixel.r).toBeCloseTo(0.537, 2);
expect(pixel.g).toBeCloseTo(0.735, 2);
expect(pixel.b).toBeCloseTo(0.881, 2);
```

Use two direct `(runtimeManager as any).sendCommandOverSocket({ command: 'capture_screenshot' })` calls in the same turn and assert that exactly one response has `ok: true` and the other has `error: 'Screenshot capture already in progress'`. Then send a third direct capture and assert it succeeds, proving the bridge-side guard clears. This bypasses the TypeScript guard and proves the GDScript guard.

- [ ] **Step 3: Run the enabled integration test and observe RED**

Run:

```bash
rtk env GODOT_PATH=/Applications/Godot_mono.app/Contents/MacOS/Godot GODOT_RUNTIME_INTEGRATION_TEST=1 npm run test -- src/runtime-control.integration.spec.ts
```

Expected: FAIL with `Unsupported command` or missing image data. A skipped test is not acceptable evidence for this step.

- [ ] **Step 4: Make the existing dispatcher async-capable**

In `src/scripts/runtime_bridge.gd`, add `var _screenshot_capture_in_flight := false` and change only the common dispatcher path:

```gdscript
func _handle_raw_message(raw_message: String) -> void:
    var parsed := JSON.parse_string(raw_message)
    if typeof(parsed) != TYPE_DICTIONARY:
        _send_message({"ok": false, "error": "Invalid message"})
        return

    var message := parsed as Dictionary
    if not message.has("command"):
        return

    var response: Dictionary = await _handle_command(message)
    if message.has("requestId"):
        response["requestId"] = message["requestId"]
    _send_message(response)
```

Add this match branch without creating another response sender:

```gdscript
        "capture_screenshot":
            return await _capture_screenshot()
```

- [ ] **Step 5: Implement bridge-side capture and guaranteed guard cleanup**

Add:

```gdscript
const MAX_SCREENSHOT_PNG_BYTES := 16 * 1024 * 1024

func _capture_screenshot() -> Dictionary:
    if _screenshot_capture_in_flight:
        return {"ok": false, "error": "Screenshot capture already in progress"}

    _screenshot_capture_in_flight = true
    var response := await _capture_screenshot_frame()
    _screenshot_capture_in_flight = false
    return response

func _capture_screenshot_frame() -> Dictionary:
    if DisplayServer.get_name() == "headless":
        return {"ok": false, "error": "Screenshot capture requires a rendered game session"}

    await RenderingServer.frame_post_draw
    var viewport := get_viewport()
    var texture := viewport.get_texture()
    var image := texture.get_image()
    if image == null or image.is_empty():
        return {"ok": false, "error": "No rendered viewport frame was available"}

    if viewport.use_hdr_2d:
        image.convert(Image.FORMAT_RGBA8)
        image.linear_to_srgb()
    elif image.get_format() != Image.FORMAT_RGBA8:
        image.convert(Image.FORMAT_RGBA8)

    var png := image.save_png_to_buffer()
    if png.is_empty():
        return {"ok": false, "error": "Failed to encode viewport as PNG"}
    if png.size() > MAX_SCREENSHOT_PNG_BYTES:
        return {
            "ok": false,
            "error": "Screenshot PNG exceeds the 16 MiB limit",
        }

    return {
        "ok": true,
        "result": {
            "pngBase64": Marshalls.raw_to_base64(png),
            "mimeType": "image/png",
            "width": image.get_width(),
            "height": image.get_height(),
            "byteLength": png.size(),
        }
    }
```

- [ ] **Step 6: Check the existing complete-write contract**

Keep `StreamPeer.put_data()` rather than adding a partial-write protocol, but inspect its returned `Error`:

```gdscript
func _send_message(message: Dictionary) -> void:
    if _client.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        return

    var payload := (JSON.stringify(message) + "\n").to_utf8_buffer()
    var error := _client.put_data(payload)
    if error != OK:
        push_warning("Godot MCP runtime bridge failed to send response: %s" % error_string(error))
        _client.disconnect_from_host()
```

- [ ] **Step 7: Build and rerun the enabled integration test**

Run: `rtk npm run build`

Expected: PASS and the generated `build/scripts/runtime_bridge.gd` contains the package version.

Run:

```bash
rtk env GODOT_PATH=/Applications/Godot_mono.app/Contents/MacOS/Godot GODOT_RUNTIME_INTEGRATION_TEST=1 npm run test -- src/runtime-control.integration.spec.ts
```

Expected: PASS for known-color PNG dimensions/pixels and bridge-side concurrent capture rejection.

- [ ] **Step 8: Commit the rendered-frame slice**

```bash
rtk git add src/scripts/runtime_bridge.gd src/runtime-control.integration.spec.ts
rtk git commit -m "feat: capture rendered runtime frames"
```

---

### Task 3: Add safe optional screenshot persistence

**Files:**
- Modify: `src/runtime-control-manager.ts:1-8,101-118,223-243,475-550,730-782`
- Modify: `src/runtime-control-manager.spec.ts`
- Modify: `src/tool-handlers.ts:23-29,110-130`
- Modify: `src/tool-handlers.runtime.spec.ts:342-368`

**Interfaces:**
- Consumes: validated `Buffer` from `validateScreenshotPayload()` and authenticated `activeRuntimeSession.expectedProjectPath`.
- Produces: working `saveTo: 'temporary' | 'project'`, `{ savedPath, saveError }`, and `RuntimeControlManager.cleanup()`.

- [ ] **Step 1: Write failing temporary, project, warning, and cleanup tests**

Add real-manager tests that respond with `createOnePixelPng()` and assert:

```ts
async function captureThroughFakeBridge(
  manager: RuntimeControlManager,
  socket: Socket,
  saveTo: ScreenshotSaveDestination
): Promise<ScreenshotCaptureResult> {
  const png = createOnePixelPng();
  const capture = manager.captureScreenshot(saveTo);
  const request = await readJsonLine(socket);
  await writeJsonLine(socket, {
    requestId: request.requestId,
    ok: true,
    result: {
      pngBase64: png.toString('base64'),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: png.length,
    },
  });
  return capture;
}

const temporary = await captureThroughFakeBridge(manager, socket, 'temporary');
expect(temporary.savedPath).toMatch(/godot-mcp-captures-/);
expect(await readFile(temporary.savedPath as string)).toEqual(png);

const project = await captureThroughFakeBridge(manager, socket, 'project');
expect(project.savedPath).toContain(join(projectPath, '.godot-mcp', 'captures'));
expect(await readFile(join(projectPath, '.godot-mcp', '.gdignore'), 'utf8')).toBe('');
```

Create `.godot-mcp` as a regular file before a project-save request and assert the result still contains the image, `savedPath` is `null`, `saveError` is non-empty, and the promise resolves. Create `.godot-mcp` as a symlink to a directory outside the project and assert the same warning result with no outside PNG.

After a temporary capture, call `manager.cleanup()` and assert both the temp file and its per-process directory no longer exist.

Update the `ToolHandlers.cleanup()` ordering test to provide `runtimeManager.cleanup()` and assert the order is `kill`, then `cleanup`.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `rtk npm run test -- src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts`

Expected: FAIL because persistence and manager cleanup are not implemented.

- [ ] **Step 3: Implement managed directories and exclusive writes**

Import `lstat`, `mkdtemp`, `realpath`, and `writeFile` from `node:fs/promises`, plus `tmpdir` from `node:os`. Add:

```ts
private temporaryCaptureDirectory: string | null = null;

private createScreenshotFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `screenshot-${timestamp}-${randomUUID()}.png`;
}

private async getTemporaryCaptureDirectory(): Promise<string> {
  if (!this.temporaryCaptureDirectory) {
    this.temporaryCaptureDirectory = await mkdtemp(join(tmpdir(), 'godot-mcp-captures-'));
  }
  return this.temporaryCaptureDirectory;
}
```

For project persistence, use the canonical `activeRuntimeSession.expectedProjectPath`, reject a symbolic `.godot-mcp` or `captures` component with `lstat()`, create missing directories, confirm the real capture directory remains under the canonical project root, and create `.gdignore` with append mode so an existing file is not truncated.

Persist with:

```ts
await writeFile(savedPath, pngBytes, { flag: 'wx' });
```

Catch persistence errors inside `captureScreenshot()` only after a valid capture and return:

```ts
{
  data: screenshot.data,
  mimeType: screenshot.mimeType,
  width: screenshot.width,
  height: screenshot.height,
  byteLength: screenshot.byteLength,
  savedPath: null,
  saveError: error instanceof Error ? error.message : 'Failed to save screenshot.',
}
```

- [ ] **Step 4: Add shutdown-only temporary cleanup**

Add:

```ts
async cleanup(): Promise<void> {
  await this.stopSession();
  const temporaryCaptureDirectory = this.temporaryCaptureDirectory;
  this.temporaryCaptureDirectory = null;
  if (temporaryCaptureDirectory) {
    await rm(temporaryCaptureDirectory, { recursive: true, force: true });
  }
}
```

Change `ToolHandlers.cleanup()` to call `runtimeControlManager.cleanup()`. Leave `handleStopProject()` and run-project restart paths on `stopSession()` so temporary captures survive until server shutdown.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `rtk npm run test -- src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts`

Expected: PASS for both destinations, symlink/file failures, image-preserving warnings, exclusive writes, and cleanup ordering.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
rtk git add src/runtime-control-manager.ts src/runtime-control-manager.spec.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
rtk git commit -m "feat: persist runtime screenshots safely"
```

---

### Task 4: Expose native MCP image content

**Files:**
- Modify: `src/types.ts:34-55`
- Modify: `src/tool-handlers.ts:23-29,619-715`
- Modify: `src/godot-server.ts:16-30,230-285,853-885`
- Modify: `src/tool-handlers.runtime.spec.ts:479-645`

**Interfaces:**
- Consumes: `RuntimeControlManager.captureScreenshot(saveTo?) -> ScreenshotCaptureResult`.
- Produces: registered `capture_screenshot`, snake-case normalization, exact MCP image content, and standard error responses.

- [ ] **Step 1: Write failing tool registration and dispatch tests**

Extend `GodotServer runtime command tools` tests to require:

```ts
expect(tools).toEqual(expect.arrayContaining([
  expect.objectContaining({
    name: 'capture_screenshot',
    inputSchema: expect.objectContaining({
      properties: expect.objectContaining({
        saveTo: expect.objectContaining({ enum: ['temporary', 'project'] }),
      }),
      required: [],
    }),
  }),
]));
```

Stub `handleCaptureScreenshot`, call through the in-memory MCP client with `{ saveTo: 'temporary' }`, and assert the handler receives the same object.

- [ ] **Step 2: Write failing handler content and error tests**

Stub `captureScreenshot()` with:

```ts
{
  data: png.toString('base64'),
  mimeType: 'image/png',
  width: 1,
  height: 1,
  byteLength: png.length,
  savedPath: null,
  saveError: 'disk full',
}
```

Call `handleCaptureScreenshot({ save_to: 'project' })` through a real `OperationExecutor.normalizeParameters()` path and assert:

```ts
expect(result).toEqual({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        width: 1,
        height: 1,
        mimeType: 'image/png',
        byteLength: png.length,
        savedPath: null,
        saveError: 'disk full',
      }, null, 2),
    },
    { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
  ],
});
expect(result).not.toHaveProperty('isError');
```

Reject the manager promise with `Runtime bridge not connected.` and assert the handler returns `isError: true`, the existing start/reconnect solutions, and no image content. Add a validation test for an unsupported `saveTo` value.

- [ ] **Step 3: Run tool tests and observe RED**

Run: `rtk npm run test -- src/tool-handlers.runtime.spec.ts`

Expected: FAIL because the tool, dispatch case, handler, and mapping are missing.

- [ ] **Step 4: Register and dispatch the tool**

Add to `GodotServer.setupToolHandlers()`:

```ts
{
  name: 'capture_screenshot',
  description: 'Capture the next rendered frame from the active running Godot game',
  inputSchema: {
    type: 'object',
    properties: {
      saveTo: {
        type: 'string',
        enum: ['temporary', 'project'],
        description: 'Optionally persist the PNG to a managed temporary or project directory',
      },
    },
    required: [],
  },
}
```

Add `case 'capture_screenshot'` beside the other runtime commands and delegate to `handleCaptureScreenshot(request.params.arguments)`.

Add `'save_to': 'saveTo'` to `PARAMETER_MAPPINGS`, and add `captureScreenshot()` plus `cleanup()` to both local `RuntimeToolManager` types.

- [ ] **Step 5: Implement exact handler success and failure mapping**

Add:

```ts
async handleCaptureScreenshot(args: any) {
  args = this.operationExecutor.normalizeParameters(args ?? {});
  if (args.saveTo !== undefined && args.saveTo !== 'temporary' && args.saveTo !== 'project') {
    return this.createErrorResponse(
      'Screenshot save destination must be "temporary" or "project".',
      ['Omit saveTo to return the image without writing a file']
    );
  }

  try {
    const result = await this.runtimeControlManager.captureScreenshot(args.saveTo);
    const metadata = {
      width: result.width,
      height: result.height,
      mimeType: result.mimeType,
      byteLength: result.byteLength,
      savedPath: result.savedPath,
      saveError: result.saveError,
    };
    return {
      content: [
        { type: 'text', text: JSON.stringify(metadata, null, 2) },
        { type: 'image', data: result.data, mimeType: result.mimeType },
      ],
    };
  } catch (error: any) {
    return this.createErrorResponse(
      `Failed to capture runtime screenshot: ${error?.message || 'Unknown error'}`,
      [
        'Start the project with runtime control enabled',
        'Reconnect or update the runtime bridge if the running project restarted',
      ]
    );
  }
}
```

- [ ] **Step 6: Run tool tests and typecheck**

Run: `rtk npm run test -- src/tool-handlers.runtime.spec.ts`

Expected: PASS for registration, dispatch, exact image content, snake-case normalization, persistence warning, and error mapping.

Run: `rtk npm run typecheck`

Expected: PASS with MCP SDK 0.6.0's `ImageContent.data` field.

- [ ] **Step 7: Commit the MCP surface**

```bash
rtk git add src/types.ts src/tool-handlers.ts src/godot-server.ts src/tool-handlers.runtime.spec.ts
rtk git commit -m "feat: expose runtime screenshot tool"
```

---

### Task 5: Version and document the bridge contract

**Files:**
- Modify: `package.json:2-4`
- Modify: `package-lock.json:2-15`
- Modify: `src/godot-server.ts:55-65`
- Modify: `src/tool-handlers.runtime.spec.ts:77-88`
- Modify: `README.md:55-80,110-150,242-260`
- Modify: `CONTRIBUTING.md:84-108`

**Interfaces:**
- Consumes: completed tool schema and exact-match bridge handshake.
- Produces: version `0.1.2`, generated compatible bridge assets, and current user/contributor documentation.

- [ ] **Step 1: Update the version test first**

Change the server metadata expectation in `src/tool-handlers.runtime.spec.ts` from `0.1.1` to `0.1.2`.

- [ ] **Step 2: Run the metadata test and observe RED**

Run: `rtk npm run test -- src/tool-handlers.runtime.spec.ts`

Expected: FAIL because `GodotServer` still reports `0.1.1`.

- [ ] **Step 3: Bump all package and server version sources**

Set `package.json`, both root-package version entries in `package-lock.json`, and the `GodotServer` initialization version to `0.1.2`. Do not hand-edit generated bridge assets; `scripts/build.js` must continue replacing `__PACKAGE_VERSION__` from `package.json`.

- [ ] **Step 4: Update README features, setup, examples, and auto-approval**

Document these exact calls:

```json
{}
```

for return-only, and:

```json
{ "saveTo": "temporary" }
```

or:

```json
{ "saveTo": "project" }
```

for persistence. State that the image is always returned, temporary files are removed on normal shutdown, project files live under `.godot-mcp/captures/`, the PNG cap is 16 MiB, headless sessions cannot capture, and an older installed bridge requires `update_runtime_bridge`. Add `capture_screenshot` to the Cline `autoApprove` array.

- [ ] **Step 5: Correct CONTRIBUTING's stale tool entry**

Replace “Saves the screenshot to the specified path” with the closed `saveTo` contract and state that callers cannot supply paths or filenames.

- [ ] **Step 6: Build and verify generated compatibility assets**

Run: `rtk npm run build`

Expected: PASS.

Run: `rtk rg -n '0\.1\.2' build/scripts/runtime_bridge.gd build/scripts/runtime_bridge_manifest.json`

Expected: both generated assets contain `0.1.2`.

Run: `rtk npm run test -- src/tool-handlers.runtime.spec.ts src/runtime-control-manager.spec.ts`

Expected: PASS with server and bridge compatibility at `0.1.2`.

- [ ] **Step 7: Commit version and documentation**

```bash
rtk git add package.json package-lock.json src/godot-server.ts src/tool-handlers.runtime.spec.ts README.md CONTRIBUTING.md
rtk git commit -m "docs: document runtime screenshot capture"
```

---

### Task 6: Run complete automated and visual verification

**Files:**
- Verify: all files changed in Tasks 1-5
- Verify: generated `build/scripts/runtime_bridge.gd`
- Verify: package contents from `npm pack --dry-run`

**Interfaces:**
- Consumes: the complete feature.
- Produces: release evidence for unit, socket, rendered integration, packaging, and visible image output.

- [ ] **Step 1: Run the focused screenshot suites**

Run:

```bash
rtk npm run test -- src/screenshot-payload.spec.ts src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts
```

Expected: PASS with no skipped screenshot unit or socket tests.

- [ ] **Step 2: Run the enabled Godot rendered integration**

Run:

```bash
rtk env GODOT_PATH=/Applications/Godot_mono.app/Contents/MacOS/Godot GODOT_RUNTIME_INTEGRATION_TEST=1 npm run test -- src/runtime-control.integration.spec.ts
```

Expected: PASS; a skip is not completion evidence.

- [ ] **Step 3: Run the full repository gates**

Run: `rtk npm run test`

Expected: all tests PASS; only pre-existing environment-gated tests may skip.

Run: `rtk npm run typecheck`

Expected: PASS.

Run: `rtk npm run build`

Expected: PASS.

Run: `rtk npm pack --dry-run`

Expected: PASS and the package includes `build/scripts/runtime_bridge.gd` plus `build/scripts/runtime_bridge_manifest.json`.

- [ ] **Step 4: Exercise all three MCP modes in Inspector**

Run: `rtk npm run inspector`

Against a project with bridge `0.1.2`, call `run_project` with `runtimeControl: true`, then call:

```json
{}
```

```json
{ "saveTo": "temporary" }
```

```json
{ "saveTo": "project" }
```

Expected: each call displays the same rendered frame as native MCP image content; metadata paths match the requested mode; the project mode creates `.godot-mcp/.gdignore` and a PNG under `.godot-mcp/captures/`.

- [ ] **Step 5: Inspect one returned image and verify cleanup**

Open one persisted PNG and compare its visible colors and dimensions with the running game. Stop the MCP server normally and verify the temporary capture path no longer exists while the project capture still exists.

- [ ] **Step 6: Check repository state and commit any verification-only fixture correction**

Run: `rtk git status --short`

Expected: clean. If the enabled integration required a deterministic fixture correction, rerun Steps 1-3, then commit only that correction with:

```bash
rtk git add src/runtime-control.integration.spec.ts
rtk git commit -m "test: stabilize screenshot integration fixture"
```
