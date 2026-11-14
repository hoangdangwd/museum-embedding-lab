// Static WASM modules are compiled by workerd, not fetched/evaluated at runtime.
import decode, { init as initDecode } from '@jsquash/jpeg/decode.js';
import encode, { init as initEncode } from '@jsquash/jpeg/encode.js';
import decoder from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import encoder from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
const options={print:()=>{},printErr:()=>{}}; // Codec errors must never log image metadata.
initDecode(decoder,options);
initEncode(encoder,options);
export { decode, encode };
