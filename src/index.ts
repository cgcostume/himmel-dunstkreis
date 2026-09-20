// The precise variant: Bruneton & Neyret, "Precomputed Atmospheric Scattering" (2008), the model osgHimmel's
// atmosphere is built on. Use `@himmel/dunstkreis/approx` for the cheaper Hillaire 2020 decomposition; the
// two share everything below and differ only in how they integrate it.
//
// The precompute pipeline (transmittance, irradiance, 4D inscatter, N scattering orders) is not implemented
// yet. What is here is the shared foundation: the model, the refraction correction, and the WGSL layer.

// biome-ignore-all assist/source/organizeImports: exports are hand-grouped by domain, not alphabetical

// The physical model, shared by both variants.
export type {
    AtmosphereModel,
    ExponentialLayer,
    PlanetGeometry,
    PrecomputedTextureConfig,
    TentLayer,
} from "./model.js";
export {
    atmosphereTopRadiusKm,
    DEFAULT_ATMOSPHERE_MODEL,
    DEFAULT_TEXTURE_CONFIG,
    OSGHIMMEL_ATMOSPHERE_MODEL,
} from "./model.js";

// Packing the model into the DkAtmosphere uniform block the shaders take.
export { ATMOSPHERE_UNIFORM_SIZE, atmosphereUniformData } from "./uniforms.js";

// Pipeline-overridable constants, for specializing a shader at pipeline creation.
export type { QualityConstants } from "./quality.js";
export { DEFAULT_QUALITY, pipelineConstants } from "./quality.js";

// Pass and LUT interfaces. This package records into passes the caller owns; it creates no device, canvas,
// context or render pass of its own.
export type { AtmosphereLUTs, SkyParams, SkyPass } from "./pass.js";

// Atmospheric refraction, as a per-ray correction. The CPU twin of the WGSL version, pinned to it by a test.
export type { RefractionConditions } from "./refraction.js";
export {
    airPressureRatio,
    atmosphericRefractionFromApparent,
    PRESSURE_SCALE_HEIGHT_M,
    refractViewDirection,
} from "./refraction.js";

// Reading a LUT back to the CPU, for inspecting or exporting one.
export type { TexturePixels } from "./readback.js";
export { readTexture } from "./readback.js";

// The raw WGSL, for inlining into a consumer's own pipelines instead of using the passes above.
export * as wgsl from "./wgsl/index.js";
