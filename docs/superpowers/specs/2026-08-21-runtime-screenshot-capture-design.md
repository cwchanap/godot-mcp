# Runtime Screenshot Capture Design

## Problem

`godot-mcp` can launch and control a running Godot project through its managed runtime bridge, but it cannot inspect the rendered game output. Agents can read debug text and runtime state, yet they cannot verify what the player actually sees.

The goal of this design is to add a first-class MCP tool that captures the running game's root viewport as an image. The same tool can optionally persist that image to a safe server-managed location when an agent needs a durable artifact.

## Goals

- Add a `capture_screenshot` MCP tool for the active running game's root viewport.
- Return the capture directly as native MCP image content.
- Let the calling agent choose whether to also persist the same PNG.
- Support persistence only inside the active project or an MCP-managed temporary directory.
- Reuse the existing authenticated runtime bridge and request/response transport.
- Capture a fully rendered frame rather than an empty or partially initialized viewport.
- Bound memory and socket usage for image responses.
- Preserve all existing runtime tools and behavior.

## Non-Goals

- Capturing the Godot editor window or other operating-system windows
- Operating-system-level screenshots or screen-recording permissions
- Capturing arbitrary `SubViewport` nodes
- JPEG, WebP, EXR, or user-selectable image formats
- User-controlled absolute output paths or custom filenames
- Image resizing, cropping, annotation, comparison, or video capture
- Screenshot capture in Godot headless mode
- Concurrent screenshot encoding in the same runtime session

## Selected Approach

Extend the managed GDScript runtime bridge with a `capture_screenshot` command. The bridge waits for the next completed render frame, reads the root viewport texture, encodes it as a PNG byte buffer, base64-encodes that buffer, and returns it through the existing authenticated newline-delimited JSON socket.

The TypeScript runtime manager validates and decodes the PNG response. It owns all optional filesystem persistence and maps the validated bytes into the MCP image response. The GDScript bridge never receives a caller-controlled path and never writes screenshot files.

This approach is preferred because it:

- reuses the current authenticated session and command routing
- keeps capture inside Godot's renderer and avoids platform screenshot APIs
- avoids a second transport or filesystem handoff protocol
- keeps output-path security and lifecycle management in TypeScript
- matches MCP's base64 image-content model directly

## Alternatives Considered

### Temporary-file handoff

The server could generate a temporary path, ask Godot to save a PNG there, read it back, and remove it. This avoids carrying the PNG over the bridge as JSON, but it introduces cross-platform path translation, filesystem permissions, cleanup races, and file trust concerns. The server would still need to base64-encode the file for MCP image content.

### Binary or chunked bridge transport

The runtime protocol could gain length-prefixed binary frames or chunked image messages. This would scale better for large media, but it would substantially complicate a currently simple JSON command protocol. A bounded single-frame PNG does not justify that additional protocol surface in v1.

## MCP Tool Contract

The new tool is:

```text
capture_screenshot({
  saveTo?: "temporary" | "project"
})
```

### Input semantics

- When `saveTo` is omitted, the screenshot is returned without a filesystem write.
- `saveTo: "temporary"` also saves the PNG in an MCP-managed temporary capture directory.
- `saveTo: "project"` also saves the PNG under `<active-project>/.godot-mcp/captures/`.
- Any other value fails schema validation.
- The tool accepts no caller-controlled output path or filename.

### Output semantics

Every successful call returns two MCP content items:

1. A text item containing JSON metadata:
   - `width`
   - `height`
   - `mimeType`, always `image/png`
   - `byteLength`
   - `savedPath`, an absolute path when persisted and `null` otherwise
2. An image item containing:
   - `type: "image"`
   - the validated base64 PNG data
   - `mimeType: "image/png"`

The image is always returned, including when persistence is requested. Persistence supplements the MCP response rather than replacing it.

## Runtime Command Contract

The TypeScript manager sends this authenticated bridge command using the existing request ID mechanism:

```json
{
  "command": "capture_screenshot",
  "requestId": "<session request ID>"
}
```

On success, the bridge returns:

```json
{
  "requestId": "<session request ID>",
  "ok": true,
  "result": {
    "pngBase64": "<base64 PNG>",
    "mimeType": "image/png",
    "width": 1280,
    "height": 720,
    "byteLength": 123456
  }
}
```

On failure, it returns the existing structured error shape:

```json
{
  "requestId": "<session request ID>",
  "ok": false,
  "error": "<specific reason>"
}
```

## Capture Flow

1. The MCP handler validates `saveTo`.
2. `RuntimeControlManager` verifies that a compatible runtime bridge is connected.
3. The manager rejects the request if another capture is already in flight.
4. The manager sends `capture_screenshot` through the active authenticated socket.
5. The bridge starts an asynchronous capture operation and awaits `RenderingServer.frame_post_draw`.
6. The bridge reads `get_viewport().get_texture().get_image()` from its root viewport.
7. The bridge rejects an unavailable, empty, or headless render result.
8. The bridge normalizes the image to `RGBA8`; when the root viewport uses HDR 2D, it also converts the linear image to sRGB so the PNG matches the displayed colors.
9. The bridge encodes the image with `save_png_to_buffer()` and enforces the decoded PNG size limit.
10. The bridge base64-encodes the PNG and returns it with dimensions and byte length.
11. TypeScript validates the response before treating it as image data.
12. When requested, TypeScript persists the validated bytes to the selected safe root.
13. The handler returns metadata and MCP image content.

Other runtime commands remain synchronous and unchanged. Screenshot capture has a dedicated asynchronous response path so `_handle_raw_message` does not attempt to use a coroutine result as a synchronous dictionary.

## Concurrency and Timeouts

Only one screenshot may be in flight for an active runtime session. A concurrent request fails immediately with a retryable `Screenshot capture already in progress` error. The design does not queue captures because queued requests could represent stale frames and multiply expensive GPU readbacks.

Capture uses the existing runtime command timeout. A timeout or socket loss follows the existing reconnect-required behavior. The in-flight guard must be cleared in a `finally` path so failed captures do not permanently block later calls.

## Payload Limits and Validation

The decoded PNG limit is **16 MiB**. The maximum newline-delimited bridge message is **24 MiB**, which accommodates base64 expansion plus the JSON envelope while preventing an unbounded receive buffer.

The bridge checks the PNG byte length before base64 encoding and returns a small structured error when it exceeds 16 MiB. The TypeScript server independently checks:

- the encoded response length before decoding
- strict base64 syntax and canonical decoding
- decoded size at or below 16 MiB
- the standard PNG file signature
- `mimeType` equals `image/png`
- positive integer width and height
- declared `byteLength` equals the decoded buffer length

If either the socket receive buffer or one complete raw message exceeds 24 MiB, the server closes the connection and applies the existing reconnect-required state. This bounds malformed or hostile bridge responses even outside the screenshot happy path.

## Persistence

Persistence happens only after the PNG passes validation.

### Temporary captures

- The server creates a per-process capture directory beneath the operating system's temporary directory.
- Filenames are generated from a UTC timestamp plus collision-resistant random data.
- Temporary captures are removed on normal server shutdown.
- Abnormal termination may leave files for the operating system's normal temporary-file cleanup.

### Project captures

- Files are written beneath `<active-project>/.godot-mcp/captures/`.
- The active project path comes from the authenticated runtime session, not tool input.
- Existing symlinks that would move the managed capture directory outside the canonical project root are rejected.
- Project captures persist until the user or agent removes them.

### Write behavior

- All files use the `.png` extension.
- Writes use unique generated names and exclusive creation; existing files are never overwritten.
- Required managed directories are created by the server.
- The absolute saved path is returned only after the write succeeds.
- If persistence was requested and fails, the entire tool call reports an error. It must not claim partial persistence success.

## Error Handling

Expected errors include:

- **runtime bridge not connected**
  - use the existing start/reconnect guidance

- **bridge version mismatch**
  - instruct the user to run `update_runtime_bridge`

- **capture already in progress**
  - tell the caller to retry after the active capture completes

- **headless or unavailable renderer**
  - state that screenshot capture requires a rendered game session

- **empty viewport image**
  - report that no rendered frame was available

- **PNG exceeds 16 MiB**
  - report the measured size and fixed v1 limit

- **invalid bridge image payload**
  - reject invalid base64, PNG signature, metadata, or size without writing a file

- **persistence failure**
  - report the selected destination and filesystem failure without exposing unrelated filesystem data

- **capture timeout or socket loss**
  - use the existing reconnect-required behavior

All failures use the existing MCP error-response convention. No failure silently returns an empty or stale image.

## Compatibility and Versioning

The bridge protocol gains a command that older installed addons do not support. The package receives a patch-version bump, and the generated bridge manifest carries that version. Existing bridge compatibility checks therefore direct users with an older installed addon to `update_runtime_bridge` before runtime control starts.

All existing tool names, inputs, responses, and runtime commands remain unchanged.

## Testing Strategy

### Runtime manager unit tests

Add coverage for:

- sending the `capture_screenshot` command
- decoding and returning a valid PNG response
- disconnected and reconnect-required behavior
- the single in-flight capture guard and guard cleanup after failure
- invalid base64 and noncanonical base64
- invalid PNG signature
- invalid MIME type, dimensions, and byte length
- decoded PNGs over 16 MiB
- socket buffers over 24 MiB
- return-only behavior with no filesystem write
- MCP-managed temporary persistence and cleanup
- project persistence beneath the authenticated project root
- refusal of symlink escape paths
- exclusive non-overwriting filenames
- persistence failures

### Tool and server tests

Add coverage for:

- tool registration and schema
- dispatch to the screenshot handler
- `saveTo` normalization and rejection of unsupported values
- metadata text content
- MCP image content with `image/png`
- structured error mapping

### Runtime bridge and integration tests

Extend the Godot integration fixture with a scene that renders known colors. Launch it with runtime control, call `capture_screenshot`, decode the result, and verify:

- PNG signature
- expected viewport dimensions
- representative pixels from the known scene
- expected sRGB output for an HDR 2D fixture when the test renderer supports it
- temporary persistence
- project persistence

The integration test remains conditionally skipped when a compatible Godot executable or render-capable environment is unavailable. Unit and socket tests must still cover the protocol in all environments.

### Completion verification

- full Vitest suite
- TypeScript typecheck
- production build
- package dry-run
- manual MCP Inspector call with no persistence
- manual MCP Inspector call with `saveTo: "temporary"`
- manual MCP Inspector call with `saveTo: "project"`
- visual inspection of at least one returned screenshot

## Documentation

Update the README to:

- list `capture_screenshot` with the runtime tools
- explain that runtime control and an up-to-date bridge are required
- document the `saveTo` modes and managed locations
- show a minimal return-only example and one persistence example
- state the 16 MiB PNG limit and headless-mode exclusion

The current `npx @coding-solo/godot-mcp` installation instructions remain unchanged.

## Acceptance Criteria

The feature is complete when:

- an agent can capture the active running game's next fully rendered root viewport frame
- the MCP response contains valid `image/png` content and accurate metadata
- the agent can choose return-only, temporary persistence, or project persistence
- no caller-controlled path can escape the approved storage roots
- oversized or malformed image responses are rejected before persistence
- concurrent capture attempts are bounded and recover after success or failure
- existing runtime tools remain compatible
- automated verification and manual visual inspection pass
