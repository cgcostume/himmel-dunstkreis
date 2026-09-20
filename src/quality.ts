import type { PrecomputedTextureConfig } from "./model.js";

/**
 * The pipeline-overridable constants declared by `wgsl/quality.wgsl`, as a typed record. These specialize a
 * shader at pipeline creation rather than being read at runtime, which lets the compiler unroll the
 * integration loops, and is why the sample counts are not part of the uniform block.
 */
export interface QualityConstants {
    /** Indexable, since this is handed straight to a pipeline descriptor's `constants` record. */
    [name: string]: number;

    DK_SAMPLES_TRANSMITTANCE: number;
    DK_SAMPLES_INSCATTER: number;
    DK_SAMPLES_IRRADIANCE: number;
    DK_SAMPLES_INSCATTER_SPHERICAL: number;
    DK_SAMPLES_MULTI_SCATTERING: number;
    DK_SAMPLES_SKY_VIEW: number;
    /** WebGPU takes booleans as 0 or 1 in the `constants` record. */
    DK_REFRACTION: number;
}

/** osgHimmel's sample counts, with refraction on. */
export const DEFAULT_QUALITY: QualityConstants = {
    DK_SAMPLES_TRANSMITTANCE: 500,
    DK_SAMPLES_INSCATTER: 50,
    DK_SAMPLES_IRRADIANCE: 32,
    DK_SAMPLES_INSCATTER_SPHERICAL: 16,
    DK_SAMPLES_MULTI_SCATTERING: 20,
    DK_SAMPLES_SKY_VIEW: 30,
    DK_REFRACTION: 1,
};

/**
 * Builds the `constants` record for a pipeline descriptor from a texture configuration, i.e.
 * `{ compute: { module, entryPoint, constants: pipelineConstants(config) } }`.
 *
 * Every key must match an `override` declared in `wgsl/quality.wgsl`, or pipeline creation fails; a test
 * pins the two lists together.
 */
export function pipelineConstants(
    config: PrecomputedTextureConfig,
    options: { refraction?: boolean } = {},
): QualityConstants {
    const { integralSamples } = config;

    return {
        DK_SAMPLES_TRANSMITTANCE: integralSamples.transmittance,
        DK_SAMPLES_INSCATTER: integralSamples.inscatter,
        DK_SAMPLES_IRRADIANCE: integralSamples.irradiance,
        DK_SAMPLES_INSCATTER_SPHERICAL: integralSamples.inscatterSpherical,
        DK_SAMPLES_MULTI_SCATTERING: integralSamples.multiScattering,
        DK_SAMPLES_SKY_VIEW: integralSamples.skyView,
        DK_REFRACTION: options.refraction === false ? 0 : 1,
    };
}
