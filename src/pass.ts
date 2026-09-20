import type { AtmosphereModel, PrecomputedTextureConfig } from "./model.js";
import type { RefractionConditions } from "./refraction.js";

/**
 * The precomputed lookup tables, owned by this package. Recomputed only when the model parameters change, not
 * per frame. Which textures are present depends on the variant that produced them.
 */
export interface AtmosphereLUTs {
    readonly model: AtmosphereModel;
    readonly config: PrecomputedTextureConfig;
    readonly transmittance: GPUTexture;
    destroy(): void;
}

/** Everything that can change per frame. */
export interface SkyParams {
    /**
     * Unit vector towards the sun, in the observer's local frame, `z` up. This must be the *true* (geometric)
     * direction: if `refraction` is enabled the pass warps view rays instead, and feeding an already-refracted
     * direction as well would lift the sun twice.
     */
    sunDirection: readonly [number, number, number];
    /** Observer height above the ground, in meters. The observer must stay within the atmosphere. */
    observerHeightM: number;
    /** Inverse view-projection matrix, column-major, used to turn fragment coordinates back into rays. */
    inverseViewProjection: Float32Array;
    /** Tone mapping exposure, applied to the physical radiance the model outputs. */
    exposure: number;
    /**
     * Per-ray atmospheric refraction. Disable it if you already refract your sun/moon directions yourself.
     * `false` is equivalent to the original's behaviour of correcting only the body directions, CPU-side.
     */
    refraction: false | RefractionConditions;
    /** osgHimmel's artistic blue-hour tint: linear RGB plus an intensity. Set the intensity to 0 to skip it. */
    lHeureBleue: { color: readonly [number, number, number]; intensity: number };
}

/**
 * A sky pass. Records into a render pass the *caller* owns and has already begun, so that the sky composes
 * with whatever else is being drawn (moon, stars, clouds) under the caller's own blending and depth rules.
 * This package never creates a device, a canvas, a context, a render pass or a swap chain.
 */
export interface SkyPass {
    /**
     * The table the render pass reads, rebuilt by `update()`. Exposed so it can be inspected or exported;
     * nothing in a normal render path needs it.
     */
    readonly skyViewTexture: GPUTexture;
    update(params: Partial<SkyParams>): void;
    encode(pass: GPURenderPassEncoder): void;
    destroy(): void;
}
