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
