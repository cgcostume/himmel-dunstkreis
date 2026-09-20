// The fast variant: Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique"
// (EGSR 2020). Same call sites as the precise `@himmel/dunstkreis` entry point, so switching the import is
// the only thing a consumer has to change, following `@himmel/sternzeit`'s precise/approx convention.
//
// "approx" is a slight misnomer, kept for that consistency: this is a different decomposition rather than a
// cheaper approximation of Bruneton, and its multiple-scattering term is infinite-order (under an isotropic
// assumption) where Bruneton's is a fixed number of orders. It is much cheaper to precompute and lower
// resolution, so "fast vs. precise" holds overall, but it will not always look worse.
//

export type { HillaireLUTs, PrecomputeOptions, SkyPassOptions } from "./hillaire.js";
export { createSkyPassApprox, precomputeAtmosphereApprox } from "./hillaire.js";
export * from "./index.js";
