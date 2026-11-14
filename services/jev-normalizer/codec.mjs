import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import decode, { init as initDecode } from '@jsquash/jpeg/decode.js';
import encode, { init as initEncode } from '@jsquash/jpeg/encode.js';
import { normalizeWithCodec } from '../../worker/jev-images.js';
const require = createRequire(import.meta.url);
const options = { print() {}, printErr() {} };
const ready = Promise.all([
  readFile(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')).then(bytes => WebAssembly.compile(bytes)).then(module => initDecode(module, options)),
  readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')).then(bytes => WebAssembly.compile(bytes)).then(module => initEncode(module, options)),
]);
// Serialized by the parent pool: a codec instance never processes two jobs.
export async function normalize(bytes) {
  await ready;
  return normalizeWithCodec(bytes, { decode, encode });
}
