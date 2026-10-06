import type { EmbeddingProvider } from "./provider.js";

// Runs fully locally via ONNX (no API key). Downloads and caches the model
// under node_modules/@xenova/transformers/.cache on first use.
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;

let pipelinePromise: Promise<any> | undefined;

async function getPipeline() {
  if (!pipelinePromise) {
    const { pipeline } = await import("@xenova/transformers");
    pipelinePromise = pipeline("feature-extraction", MODEL_NAME);
  }
  return pipelinePromise;
}

export const localEmbeddingProvider: EmbeddingProvider = {
  dims: DIMS,
  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await getPipeline();
    const results: Float32Array[] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      results.push(Float32Array.from(output.data as Float32Array));
    }
    return results;
  },
};
