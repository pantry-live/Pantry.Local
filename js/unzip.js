/*
 * Pantry — minimal ZIP reader.
 *
 * Reads the central directory, then each entry. Stored (uncompressed) and
 * deflate entries are supported. Deflate uses the browser's built-in
 * DecompressionStream, so no library is needed.
 */

const decoder = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("unsupported-browser");
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ name: string, text: string }[]>}
 */
export async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-central-directory record sits in the last 64 KB plus 22 bytes.
  let end = -1;
  const lowest = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not-a-zip");

  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const entries = [];

  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(position, true) !== 0x02014b50) throw new Error("bad-zip");

    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const compressedSize = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);

    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) content = data;
    else if (method === 8) content = await inflateRaw(data);
    else throw new Error("unsupported-compression");

    entries.push({ name, text: decoder.decode(content), flags });
  }

  return entries;
}