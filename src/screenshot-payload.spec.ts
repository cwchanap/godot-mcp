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
