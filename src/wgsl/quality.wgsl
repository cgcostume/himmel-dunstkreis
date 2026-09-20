// Pipeline-overridable constants, WGSL's specialization mechanism. Unlike the physical parameters in
// `atmosphere.wgsl`, these are not data the shader reads at runtime: they are fixed when the pipeline is
// created, so the compiler can unroll the integration loops and fold the bounds away.
//
// That is exactly right for quality knobs. Changing one means recompiling a pipeline, which is what you want
// for a quality preset switched at most a handful of times, and wrong for something read per frame. Set them
// through `constants` on the pipeline descriptor; `pipelineConstants()` builds that record.

// Samples along the view ray when integrating optical depth for the transmittance LUT. The single largest
// quality/cost lever in the precompute, and the reason it is an override: the loop bound has to be a
// constant for the compiler to unroll it.
override DK_SAMPLES_TRANSMITTANCE: u32 = 500u;

// Samples for the single-scattering integral, Bruneton's inscatter1 pass.
override DK_SAMPLES_INSCATTER: u32 = 50u;

// Samples for the irradiance integral over the hemisphere.
override DK_SAMPLES_IRRADIANCE: u32 = 32u;

// Samples for the spherical integral in Bruneton's multiple-scattering orders, which is quadratic in this
// count, so it dominates precompute time.
override DK_SAMPLES_INSCATTER_SPHERICAL: u32 = 16u;

// Samples for Hillaire's multiple-scattering LUT.
override DK_SAMPLES_MULTI_SCATTERING: u32 = 20u;

// Raymarch steps for Hillaire's per-frame sky-view LUT. The only one of these on the per-frame path.
override DK_SAMPLES_SKY_VIEW: u32 = 30u;

// Whether the render pass warps view rays for atmospheric refraction. An override rather than a uniform so
// that turning it off compiles the work out entirely instead of branching per pixel, and so that a consumer
// who already feeds refracted sun and moon directions pays nothing for the feature they must not use.
//
// Consumed by the render pass, not by `refraction.wgsl`: that snippet stays free of every override and every
// uniform, so it can be pasted into the moon, star and cloud modules on its own.
override DK_REFRACTION: bool = true;
