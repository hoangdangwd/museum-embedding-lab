// Only Jev copies are changed; embedding input and approved R2 JPEGs stay untouched.
export const NORMALIZATION = 'rgb-oriented-bilinear-jpeg95-fit1568-pad280-v1';
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export function jpegFrame(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 4 || bytes.length > MAX_SOURCE_BYTES || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error('INVALID_IMAGE');
  let offset = 2, size;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 255) throw Error('INVALID_IMAGE');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) { if (!size) throw Error('INVALID_IMAGE'); return size; }
    if ([0,1,0xd8,0xd9].includes(marker) || marker >= 0xd0 && marker <= 0xd7) throw Error('INVALID_IMAGE');
    const n = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isInteger(n) || n < 2 || offset + n > bytes.length) throw Error('INVALID_IMAGE');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size || n !== 17 || bytes[offset + 2] !== 8 || bytes[offset + 7] !== 3) throw Error('INVALID_IMAGE');
      const height = bytes[offset + 3] * 256 + bytes[offset + 4], width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (Math.min(width, height) < 64 || Math.max(width, height) > 1600) throw Error('INVALID_IMAGE');
      size = { width, height };
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) throw Error('INVALID_IMAGE');
    offset += n;
  }
  throw Error('INVALID_IMAGE');
}
export function fitPixels(image) {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width,height) < 64 || Math.max(width,height) > 1600 || data?.length !== width * height * 4) throw Error('INVALID_IMAGE');
  const scale = Math.min(1,1568 / Math.max(width,height));
  const w = Math.max(1,Math.round(width*scale)), h = Math.max(1,Math.round(height*scale));
  const outputWidth = Math.max(280,w), outputHeight = Math.max(280,h);
  if (w===width && h===height && outputWidth===width && outputHeight===height) return image;
  // Downsampling traverses top-left to bottom-right; each source index is at
  // or ahead of its destination, so an unpadded shrink can reuse the decoded
  // RGBA allocation. Avoid a second10MB pixel buffer in128MB Worker isolates.
  const padded=outputWidth!==w||outputHeight!==h;
  const out=padded?new Uint8ClampedArray(outputWidth*outputHeight*4):data.subarray(0,w*h*4);
  if(padded)out.fill(255);
  const left = Math.floor((outputWidth-w)/2), top = Math.floor((outputHeight-h)/2);
  for (let y=0;y<h;y++) {
    const sy=Math.max(0,Math.min(height-1,(y+.5)*height/h-.5)), y0=Math.floor(sy), y1=Math.min(y0+1,height-1), fy=sy-y0;
    for (let x=0;x<w;x++) {
      const sx=Math.max(0,Math.min(width-1,(x+.5)*width/w-.5)), x0=Math.floor(sx), x1=Math.min(x0+1,width-1), fx=sx-x0;
      const a=(y0*width+x0)*4,b=(y0*width+x1)*4,c=(y1*width+x0)*4,d=(y1*width+x1)*4,o=((y+top)*outputWidth+x+left)*4;
      for(let k=0;k<3;k++) out[o+k]=Math.round((data[a+k]*(1-fx)+data[b+k]*fx)*(1-fy)+(data[c+k]*(1-fx)+data[d+k]*fx)*fy);
      out[o+3]=255;
    }
  }
  return { data:out,width:outputWidth,height:outputHeight };
}
export async function normalizeWithCodec(input, codec) {
  const source=input instanceof Uint8Array?input:new Uint8Array(input);
  jpegFrame(source); // Bound decoder allocations BEFORE decode (max2.56MP).
  const image=await codec.decode(source,{preserveOrientation:false}); // EXIF orientation applied by libjpeg wrapper.
  const pixels=fitPixels(image);
  const output=new Uint8Array(await codec.encode(pixels,{quality:95,progressive:false,baseline:true,optimize_coding:false,quant_table:0,trellis_multipass:false,trellis_opt_zero:false,trellis_opt_table:false,chroma_subsample:2}));
  const frame=jpegFrame(output);
  if(Math.min(frame.width,frame.height)<280||Math.max(frame.width,frame.height)>1568)throw Error('INVALID_IMAGE');
  return output;
}
export async function normalizeJevImage(input) {
  const codec=await import('./jev-codec.js');
  return normalizeWithCodec(input,codec);
}
