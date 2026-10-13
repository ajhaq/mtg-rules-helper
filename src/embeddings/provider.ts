export interface EmbeddingProvider {
  readonly dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function floatsToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToFloats(buf: Uint8Array): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

//determines similarity based on the cosine of the angle between the two vectors
//-1 to 1, 1 = vectors point in same direction (most similar), 0 = vectors are orthogonal (no similarity), -1 = vectors point in opposite directions
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
