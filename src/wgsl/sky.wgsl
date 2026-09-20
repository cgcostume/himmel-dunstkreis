// The sky render pass: a fullscreen triangle that turns the precomputed tables into pixels. Requires
// `atmosphere.wgsl`, `common.wgsl`, `lut.wgsl`, `sampling.wgsl`, `refraction.wgsl` and `quality.wgsl`.
//
// Records into a render pass the caller owns and has already begun, so the sky composes with whatever else
// is being drawn under the caller's own blending and depth rules.

struct DkSkyParams {
    inverseViewProjection: mat4x4f,
    // Unit vector towards the sun in the observer's local frame, z up. The TRUE direction: when DK_REFRACTION
    // is on this pass bends view rays instead, and supplying an already-refracted sun would move it twice.
    sunDirection: vec3f,
    observerRadius: f32,
    // osgHimmel's artistic blue-hour tint, on top of the physical model. Intensity 0 skips it.
    lHeureBleueColor: vec3f,
    lHeureBleueIntensity: f32,
    exposure: f32,
    sunAngularRadius: f32,
    observerHeightM: f32,
    temperatureC: f32,
}

@group(0) @binding(0) var<uniform> dkAtmosphere: DkAtmosphere;
@group(0) @binding(1) var<uniform> dkParams: DkSkyParams;
@group(0) @binding(2) var dkTransmittanceLut: texture_2d<f32>;
@group(0) @binding(3) var dkSkyViewLut: texture_2d<f32>;
@group(0) @binding(4) var dkLutSampler: sampler;

struct DkVertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

// One oversized triangle rather than two triangles: no seam along the diagonal, and no vertex buffer.
@vertex
fn dkSkyVertex(@builtin(vertex_index) index: u32) -> DkVertexOutput {
    let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));

    var out: DkVertexOutput;
    out.position = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2f(uv.x, 1.0 - uv.y);
    return out;
}

// Bruneton's tone curve, as osgHimmel used it: a gamma ramp in the low range and an exponential rolloff
// above, which keeps the sun's surroundings from clipping to white while leaving twilight readable.
fn dkToneMapChannel(value: f32) -> f32 {
    if (value < 1.413) {
        return pow(value * 0.38317, 1.0 / 2.2);
    }
    return 1.0 - exp(-value);
}

fn dkToneMap(luminance: vec3f, exposure: f32) -> vec3f {
    let scaled = luminance * exposure;
    return vec3f(dkToneMapChannel(scaled.r), dkToneMapChannel(scaled.g), dkToneMapChannel(scaled.b));
}

@fragment
fn dkSkyFragment(input: DkVertexOutput) -> @location(0) vec4f {
    let a = dkAtmosphere;

    // Fragment back to a world-space ray. The observer sits at the origin of this frame, so the point on the
    // far plane is the direction.
    let ndc = vec4f(input.uv.x * 2.0 - 1.0, 1.0 - input.uv.y * 2.0, 1.0, 1.0);
    let far = dkParams.inverseViewProjection * ndc;
    var direction = normalize(far.xyz / far.w);

    // A camera ray is an apparent direction, so it is warped to the true one before anything is looked up.
    // An override rather than a branch: with DK_REFRACTION off, none of this is in the compiled pipeline.
    if (DK_REFRACTION) {
        direction = dkRefractViewDirection(direction, dkParams.observerHeightM, dkParams.temperatureC);
    }

    let r = clamp(dkParams.observerRadius, a.Rg, a.Rt);
    let mu = clamp(direction.z, -1.0, 1.0);
    let sunDirection = dkParams.sunDirection;

    // Azimuth measured from the sun, the frame the sky-view table is indexed in. Degenerate when either
    // vector points straight up, where azimuth is meaningless and any value gives the same lookup.
    let directionH = direction.xy;
    let sunH = sunDirection.xy;
    var cosAzimuth = 1.0;
    if (length(directionH) > 1e-6 && length(sunH) > 1e-6) {
        cosAzimuth = clamp(dot(normalize(directionH), normalize(sunH)), -1.0, 1.0);
    }

    let skyViewSize = vec2f(textureDimensions(dkSkyViewLut));
    let uv = dkSkyViewUv(a, r, mu, cosAzimuth, skyViewSize);
    var luminance = textureSampleLevel(dkSkyViewLut, dkLutSampler, uv, 0.0).rgb;

    // The sun's own disc, attenuated by the air between it and the observer, and only when it is actually in
    // view of the sky rather than behind the planet.
    let hitsGround = dkIntersectsGround(a, r, mu);
    if (!hitsGround && dot(direction, sunDirection) > cos(dkParams.sunAngularRadius)) {
        let transmittance = dkSampleTransmittanceToTop(a, dkTransmittanceLut, dkLutSampler, r, mu);
        luminance = luminance + transmittance * a.solarIrradiance;
    }

    var color = dkToneMap(luminance, dkParams.exposure);

    // The blue hour, an artistic term rather than a physical one, strongest when the sun sits just below the
    // horizon. The +0.03 keeps a faint blue cast through the night, as in the original.
    if (dkParams.lHeureBleueIntensity > 0.0 && !hitsGround) {
        let falloff = exp(-sunDirection.z * sunDirection.z * 166.0) + 0.03;
        color = color
            + dkParams.lHeureBleueIntensity * dkParams.lHeureBleueColor
            * (dot(direction, sunDirection) + 1.5) * falloff;
    }

    return vec4f(color, 1.0);
}
