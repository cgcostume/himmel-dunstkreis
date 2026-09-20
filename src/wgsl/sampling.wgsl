// Sampling the precomputed tables. Requires `atmosphere.wgsl`, `common.wgsl` and `lut.wgsl`.
//
// Split out from the passes that write the tables so that the render path, the multiple-scattering pass and
// a consumer's own shader can all read them the same way.

// Transmittance from a point at (r, mu) to the top of the atmosphere, by lookup rather than integration.
fn dkSampleTransmittanceToTop(
    a: DkAtmosphere,
    lut: texture_2d<f32>,
    lutSampler: sampler,
    r: f32,
    mu: f32,
) -> vec3f {
    let size = vec2f(textureDimensions(lut));
    return textureSampleLevel(lut, lutSampler, dkTransmittanceUv(a, r, mu, size), 0.0).rgb;
}

// Transmittance along a finite segment, as the ratio of the two to-the-top transmittances at its ends. Which
// end divides which depends on whether the ray is rising or falling, since the table only stores upward
// paths. The min(..., 1) guards the case where rounding makes the ratio exceed unity.
fn dkSampleTransmittanceSegment(
    a: DkAtmosphere,
    lut: texture_2d<f32>,
    lutSampler: sampler,
    r: f32,
    mu: f32,
    d: f32,
    intersectsGround: bool,
) -> vec3f {
    let rd = clamp(sqrt(max(d * d + 2.0 * r * mu * d + r * r, 0.0)), a.Rg, a.Rt);
    let mud = clamp((r * mu + d) / rd, -1.0, 1.0);

    if (intersectsGround) {
        let near = dkSampleTransmittanceToTop(a, lut, lutSampler, rd, -mud);
        let far = dkSampleTransmittanceToTop(a, lut, lutSampler, r, -mu);
        return min(near / max(far, vec3f(1e-6)), vec3f(1.0));
    }

    let near = dkSampleTransmittanceToTop(a, lut, lutSampler, r, mu);
    let far = dkSampleTransmittanceToTop(a, lut, lutSampler, rd, mud);
    return min(near / max(far, vec3f(1e-6)), vec3f(1.0));
}

// Hillaire's multiple-scattering term: the light that reached this point after more than one bounce, summed
// over every order at once. Stored isotropically, so it needs no phase function on lookup.
fn dkSampleMultiScattering(
    a: DkAtmosphere,
    lut: texture_2d<f32>,
    lutSampler: sampler,
    r: f32,
    muS: f32,
) -> vec3f {
    let size = vec2f(textureDimensions(lut));
    return textureSampleLevel(lut, lutSampler, dkMultiScatteringUv(a, r, muS, size), 0.0).rgb;
}
