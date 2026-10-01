// Optional browser utility; no UI, crop interaction, backend credentials or model calls.
// Preserve media.js and camera-zoom.js together if copying this into another project.
import { jpeg } from '../src/media.js';

export async function prepareRecognitionImage(file) {
  return jpeg(file); // Full image, EXIF orientation, white alpha background, max 1600px.
}
