/**
 * The WGSL layer, exported as plain strings so a consumer can compose these snippets into their own shader
 * instead of using this package's passes at all.
 *
 * The snippets are deliberately binding-free: `common` takes the `DkAtmosphere` struct from `atmosphere` by
 * value rather than reading a `var<uniform>`, and `refraction` needs neither. So composing is concatenation
 * plus declaring the binding yourself, and nothing here can collide with your own group/binding indices.
 * Fill the uniform buffer with `atmosphereUniformData()`. Quality knobs are separate again: `quality` holds
 * WGSL `override` declarations, set at pipeline creation via `pipelineConstants()`, so that loop bounds stay
 * compile-time constants and an unused feature compiles out rather than branching.
 *
 * Every identifier is prefixed `dk` (or `DK_` for constants) so several `@himmel/*` fragments can share one
 * shader module.
 */
import atmosphere from "./atmosphere.wgsl";
import common from "./common.wgsl";
import lut from "./lut.wgsl";
import multiscattering from "./multiscattering.wgsl";
import quality from "./quality.wgsl";
import refraction from "./refraction.wgsl";
import sampling from "./sampling.wgsl";
import sky from "./sky.wgsl";
import skyview from "./skyview.wgsl";
import transmittance from "./transmittance.wgsl";

export { atmosphere, common, lut, multiscattering, quality, refraction, sampling, sky, skyview, transmittance };

/** The composable pieces, in the order WGSL needs them declared. No bindings, no entry points. */
export const scattering = [atmosphere, common, lut, sampling].join("\n");

/** `scattering` plus the overrides, which the passes below additionally need. */
export const scatteringWithQuality = [quality, scattering].join("\n");
