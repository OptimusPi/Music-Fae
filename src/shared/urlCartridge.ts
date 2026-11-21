import { BeatDocument, validateBeatDocument } from './beatSchema';

const HASH_PREFIX = '#beat=';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    await writer.write(new Uint8Array(data));
    await writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function decompressDeflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(data));
    await writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export interface EncodedCartridge {
  hash: string;
  url: string;
  byteLength: number;
  compressed: boolean;
}

/**
 * Encodes an entire BeatDocument (BPM, scale, marchers, and cube recipes)
 * into a compact URL hash (`#beat=z...` when deflate-raw compressed, `#beat=j...` fallback).
 */
export async function encodeBeatToUrlCartridge(doc: BeatDocument): Promise<EncodedCartridge> {
  const json = JSON.stringify(doc);
  const rawBytes = new TextEncoder().encode(json);
  const deflated = await compressDeflateRaw(rawBytes);

  const compressed = Boolean(deflated && deflated.length < rawBytes.length);
  const payload = compressed && deflated ? `z${bytesToBase64Url(deflated)}` : `j${bytesToBase64Url(rawBytes)}`;
  const hash = `${HASH_PREFIX}${payload}`;
  const baseUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;

  return {
    hash,
    url: `${baseUrl}${hash}`,
    byteLength: payload.length,
    compressed,
  };
}

/**
 * Decodes and validates a `#beat=...` cartridge from a URL hash string.
 */
export async function decodeBeatFromUrlHash(hashStr: string): Promise<BeatDocument | null> {
  if (!hashStr || !hashStr.startsWith(HASH_PREFIX)) return null;
  const payload = hashStr.slice(HASH_PREFIX.length).trim();
  if (payload.length < 4) return null;

  const mode = payload[0];
  const body = payload.slice(1);
  try {
    const bytes = base64UrlToBytes(body);
    let jsonText: string;
    if (mode === 'z') {
      const inflated = await decompressDeflateRaw(bytes);
      if (!inflated) return null;
      jsonText = new TextDecoder().decode(inflated);
    } else if (mode === 'j') {
      jsonText = new TextDecoder().decode(bytes);
    } else {
      // Legacy unprefixed JSON base64url
      jsonText = new TextDecoder().decode(base64UrlToBytes(payload));
    }

    const parsed = JSON.parse(jsonText);
    const validated = validateBeatDocument(parsed);
    return validated.document ?? null;
  } catch {
    return null;
  }
}
