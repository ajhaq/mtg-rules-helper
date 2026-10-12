import { localEmbeddingProvider } from "../src/embeddings/localProvider.js";

//run one simple embedding so the model gets downloaded
//we do this so the model builds at image build time rather than the actual first use of the app
const [vec] = await localEmbeddingProvider.embed(["warm up"]);
console.log(`Model ready. ${vec.length} dimensions.`);