// Transmittance LUT precompute, shared by both variants. Requires `atmosphere.wgsl`, `common.wgsl`,
// `lut.wgsl` and `quality.wgsl`.
//
// Unlike those snippets, this is a pass: it owns an entry point and therefore has to declare its bindings.
// The composable pieces stay binding-free; only the pipelines this package builds itself fix indices.

@group(0) @binding(0) var<uniform> dkAtmosphere: DkAtmosphere;
@group(0) @binding(1) var dkTransmittanceOut: texture_storage_2d<rgba16float, write>;

// Optical depth from a point at (r, mu) to the top of the atmosphere, integrated with the trapezoid rule.
// DK_SAMPLES_TRANSMITTANCE is an override, so this loop bound is a compile-time constant and unrollable.
fn dkOpticalDepthToTop(a: DkAtmosphere, r: f32, mu: f32) -> vec3f {
    let distance = dkDistanceToTopAtmosphereBoundary(a, r, mu);
    let steps = f32(DK_SAMPLES_TRANSMITTANCE);

    var depth = vec3f(0.0);
    for (var i = 0u; i <= DK_SAMPLES_TRANSMITTANCE; i = i + 1u) {
        let t = f32(i) / steps * distance;

        // Radius at the sample, by the law of cosines along the ray. Clamped because the expression can dip
        // marginally below Rg at grazing angles purely through rounding.
        let ri = max(sqrt(max(t * t + 2.0 * r * mu * t + r * r, 0.0)), a.Rg);
        let weight = select(1.0, 0.5, i == 0u || i == DK_SAMPLES_TRANSMITTANCE);

        depth = depth + dkExtinction(a, ri - a.Rg) * weight;
    }

    return depth * (distance / steps);
}

/** Fraction of light surviving the path from (r, mu) to the top of the atmosphere. Beer-Lambert. */
fn dkComputeTransmittanceToTop(a: DkAtmosphere, r: f32, mu: f32) -> vec3f {
    return exp(-dkOpticalDepthToTop(a, r, mu));
}

@compute @workgroup_size(8, 8)
fn dkPrecomputeTransmittance(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2f(textureDimensions(dkTransmittanceOut));
    if (f32(id.x) >= size.x || f32(id.y) >= size.y) {
        return;
    }

    let uv = (vec2f(f32(id.x), f32(id.y)) + 0.5) / size;
    let rMu = dkTransmittanceRMu(dkAtmosphere, uv, size);

    let transmittance = dkComputeTransmittanceToTop(dkAtmosphere, rMu.x, rMu.y);
    textureStore(dkTransmittanceOut, vec2i(id.xy), vec4f(transmittance, 1.0));
}
