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
