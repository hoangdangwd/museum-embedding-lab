// Node-only test bridge; production workerd receives statically compiled modules.
export async function load(url, context, nextLoad) {
  if(url.endsWith('.wasm'))return {format:'module',shortCircuit:true,source:`import {readFile} from 'node:fs/promises';export default await WebAssembly.compile(await readFile(new URL(${JSON.stringify(url)})));`};
  return nextLoad(url,context);
}
