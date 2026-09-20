// The atmosphere's physical parameters as a uniform block, so a consumer can bind one buffer and compose
// these functions into their own shader. `@himmel/dunstkreis` fills it via `atmosphereUniformData()`.
//
// Nothing here declares a binding: the struct is passed to every function by value instead. That keeps the
// snippet free of any assumption about group or binding indices, which is what makes it droppable into an
// existing pipeline. Declare the `var<uniform>` yourself, at whatever group and binding suit you.
//
// Scalars are packed into the tails of the vec3s, which WGSL's 16-byte vec3 alignment leaves free, giving
// a 96-byte block. `atmosphereUniformData()` writes exactly this layout and a test pins the two together.
struct DkAtmosphere {
    // Rayleigh scattering coefficient, per km, per channel. Doubles as its extinction: air does not absorb.
    betaR: vec3f,
    // Ground radius, in km.
    Rg: f32,

    // Mie scattering coefficient, per km.
    betaMSca: vec3f,
    // Radius of the top of the atmosphere, in km. The observer must stay below this.
    Rt: f32,

    // Mie extinction coefficient, i.e. scattering plus absorption.
    betaMEx: vec3f,
    // Cornette-Shanks asymmetry factor. Positive is forward-scattering.
    mieG: f32,

    // Ozone absorption coefficient, per km. Ozone only absorbs, so it has no scattering counterpart.
    betaOAbs: vec3f,
    // Rayleigh scale height, in km.
    HR: f32,

    // Irradiance at the top of the atmosphere, per channel.
    solarIrradiance: vec3f,
    // Mie scale height, in km.
    HM: f32,

    // Centre altitude of the ozone layer, in km, and half its linear falloff width.
    ozoneCenter: f32,
    ozoneHalfWidth: f32,
    // Average ground reflectance, for the irradiance bounce.
    avgGroundReflectance: f32,

    _padding: f32,
}
