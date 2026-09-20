// Hillaire's sky-view LUT, recomputed per frame. Requires `atmosphere.wgsl`, `common.wgsl`, `lut.wgsl`,
// `sampling.wgsl` and `quality.wgsl`. A pass, so it declares its bindings.
//
// Cheap enough to rebuild every frame (a 192x108 table, 30 steps each) and it turns the render pass into a
// single texture fetch per pixel. The sun's position is baked into it, so it has to follow the sun; the
// transmittance and multiple-scattering tables above it do not, and are only rebuilt when the model changes.

struct DkSkyViewParams {
    // Unit vector towards the sun in the observer's local frame, z up. The true direction, not a refracted
    // one: refraction is applied to view rays at render time, and applying both would move the sun twice.
    sunDirection: vec3f,
    // Observer radius, i.e. Rg plus height above the ground, in km.
    observerRadius: f32,
}

@group(0) @binding(0) var<uniform> dkAtmosphere: DkAtmosphere;
@group(0) @binding(1) var<uniform> dkParams: DkSkyViewParams;
@group(0) @binding(2) var dkTransmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var dkMultiScatteringLut: texture_2d<f32>;
@group(0) @binding(4) var dkLutSampler: sampler;
@group(0) @binding(5) var dkSkyViewOut: texture_storage_2d<rgba16float, write>;

/**
 * Scattered light reaching the observer along a view ray: single scattering with its phase functions, plus
 * the precomputed multiple-scattering term. Usable on its own if you would rather raymarch per pixel than
 * go through the sky-view table.
 */
fn dkRaymarchSky(a: DkAtmosphere, origin: vec3f, direction: vec3f, sunDirection: vec3f, steps: u32) -> vec3f {
    let r = clamp(length(origin), a.Rg, a.Rt);
    let mu = dot(origin, direction) / r;
    let nu = dot(direction, sunDirection);

    let hitsGround = dkIntersectsGround(a, r, mu);
    var tMax = dkDistanceToTopAtmosphereBoundary(a, r, mu);
    if (hitsGround) {
        tMax = dkDistanceToBottomAtmosphereBoundary(a, r, mu);
    }

    let phaseR = dkPhaseRayleigh(nu);
    let phaseM = dkPhaseMie(a, nu);

    var luminance = vec3f(0.0);
    var throughput = vec3f(1.0);
    let dt = tMax / f32(steps);

    for (var i = 0u; i < steps; i = i + 1u) {
        let position = origin + direction * (f32(i) + 0.5) * dt;
        let ri = clamp(length(position), a.Rg, a.Rt);
        let altitude = ri - a.Rg;
        let muS = clamp(dot(position, sunDirection) / ri, -1.0, 1.0);

        let densityR = dkDensityRayleigh(a, altitude);
        let densityM = dkDensityMie(a, altitude);
        let scattering = a.betaR * densityR + a.betaMSca * densityM;
        let extinction = max(dkExtinction(a, altitude), vec3f(1e-9));
        let stepTransmittance = exp(-extinction * dt);

        var sunTransmittance = vec3f(0.0);
        if (!dkIntersectsGround(a, ri, muS)) {
            sunTransmittance = dkSampleTransmittanceToTop(a, dkTransmittanceLut, dkLutSampler, ri, muS);
        }

        // Single scattering carries the phase functions, which is what puts the glow around the sun and the
        // blue overhead. The multiple-scattering term does not: it was built isotropically on purpose.
        let single = sunTransmittance * (a.betaR * densityR * phaseR + a.betaMSca * densityM * phaseM);
        let multiple = dkSampleMultiScattering(a, dkMultiScatteringLut, dkLutSampler, ri, muS) * scattering;

        let inScatter = a.solarIrradiance * (single + multiple);
        luminance = luminance + throughput * (inScatter - inScatter * stepTransmittance) / extinction;
        throughput = throughput * stepTransmittance;
    }

    return luminance;
}

@compute @workgroup_size(8, 8)
fn dkPrecomputeSkyView(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2f(textureDimensions(dkSkyViewOut));
    if (f32(id.x) >= size.x || f32(id.y) >= size.y) {
        return;
    }

    let a = dkAtmosphere;
    let r = clamp(dkParams.observerRadius, a.Rg, a.Rt);
    let uv = (vec2f(f32(id.x), f32(id.y)) + 0.5) / size;

    let muAzimuth = dkSkyViewMuAzimuth(a, r, uv, size);
    let mu = muAzimuth.x;
    let cosAzimuth = muAzimuth.y;

    // Rebuild a view direction in the frame the table is indexed in: z up, azimuth measured from the sun.
    let sinView = sqrt(max(1.0 - mu * mu, 0.0));
    let sinAzimuth = sqrt(max(1.0 - cosAzimuth * cosAzimuth, 0.0));
    let direction = vec3f(sinView * cosAzimuth, sinView * sinAzimuth, mu);

    // The sun placed in that same frame, at azimuth zero by construction.
    let muS = clamp(dkParams.sunDirection.z, -1.0, 1.0);
    let sunDirection = vec3f(sqrt(max(1.0 - muS * muS, 0.0)), 0.0, muS);

    let luminance = dkRaymarchSky(a, vec3f(0.0, 0.0, r), direction, sunDirection, DK_SAMPLES_SKY_VIEW);
    textureStore(dkSkyViewOut, vec2i(id.xy), vec4f(luminance, 1.0));
}
