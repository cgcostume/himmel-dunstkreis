// Mappings between physical parameters and LUT texture coordinates. Requires `atmosphere.wgsl` and
// `common.wgsl`. Like those, this declares no bindings and takes the struct by value.
//
// The transmittance mapping is Bruneton's, shared by both variants. It is not a linear remap of (r, mu):
// it is built around the distance to the top of the atmosphere, which concentrates resolution near the
// horizon where the sky's gradient is steep, and it is exactly invertible, which is what lets the precompute
// pass and the sampling path agree.

// Texels sample at their centres, so a unit-range value has to be squeezed into [0.5/n, 1 - 0.5/n] to line
// up with them. Getting this wrong shifts every LUT lookup by half a texel, which shows up as a seam at the
// horizon rather than as an obvious error.
fn dkUnitToTextureCoord(x: f32, n: f32) -> f32 {
    return 0.5 / n + x * (1.0 - 1.0 / n);
}

fn dkTextureToUnitCoord(u: f32, n: f32) -> f32 {
    return (u - 0.5 / n) / (1.0 - 1.0 / n);
}

// (r, mu) -> uv in the transmittance LUT.
fn dkTransmittanceUv(a: DkAtmosphere, r: f32, mu: f32, size: vec2f) -> vec2f {
    let H = dkHorizonDistanceAtTop(a);
    let rho = dkRho(a, r);

    let d = dkDistanceToTopAtmosphereBoundary(a, r, mu);
    let dMin = a.Rt - r;
    let dMax = rho + H;

    let xMu = select(0.0, (d - dMin) / max(dMax - dMin, 1e-6), dMax > dMin);
    let xR = rho / max(H, 1e-6);

    return vec2f(dkUnitToTextureCoord(xMu, size.x), dkUnitToTextureCoord(xR, size.y));
}

// uv in the transmittance LUT -> (r, mu). The exact inverse of the above.
fn dkTransmittanceRMu(a: DkAtmosphere, uv: vec2f, size: vec2f) -> vec2f {
    let xMu = dkTextureToUnitCoord(uv.x, size.x);
    let xR = dkTextureToUnitCoord(uv.y, size.y);

    let H = dkHorizonDistanceAtTop(a);
    let rho = H * clamp(xR, 0.0, 1.0);
    let r = sqrt(rho * rho + a.Rg * a.Rg);

    let dMin = a.Rt - r;
    let dMax = rho + H;
    let d = dMin + clamp(xMu, 0.0, 1.0) * (dMax - dMin);

    var mu = 1.0;
    if (d > 0.0) {
        mu = (H * H - rho * rho - d * d) / (2.0 * r * d);
    }

    return vec2f(r, clamp(mu, -1.0, 1.0));
}

// Hillaire's multiple-scattering LUT is indexed by the sun's elevation and the observer's altitude, both
// linearly: the table is small and smooth, so there is nothing to concentrate resolution on.
fn dkMultiScatteringUv(a: DkAtmosphere, r: f32, muS: f32, size: vec2f) -> vec2f {
    let xMuS = clamp(muS * 0.5 + 0.5, 0.0, 1.0);
    let xR = clamp((r - a.Rg) / max(a.Rt - a.Rg, 1e-6), 0.0, 1.0);

    return vec2f(dkUnitToTextureCoord(xMuS, size.x), dkUnitToTextureCoord(xR, size.y));
}

fn dkMultiScatteringRMuS(a: DkAtmosphere, uv: vec2f, size: vec2f) -> vec2f {
    let xMuS = dkTextureToUnitCoord(uv.x, size.x);
    let xR = dkTextureToUnitCoord(uv.y, size.y);

    return vec2f(a.Rg + clamp(xR, 0.0, 1.0) * (a.Rt - a.Rg), clamp(xMuS, 0.0, 1.0) * 2.0 - 1.0);
}

// The sky-view LUT is indexed by view direction, in a frame whose azimuth is measured from the sun. The
// vertical axis is split at the horizon and square-rooted on each side, spending most of the resolution
// within a few degrees of it, which is where nearly all of the sky's variation lives.
fn dkSkyViewUv(a: DkAtmosphere, r: f32, mu: f32, cosLightAzimuth: f32, size: vec2f) -> vec2f {
    let horizon = dkHorizonMu(a, r);
    let zenithHorizonAngle = acos(clamp(horizon, -1.0, 1.0));
    let viewZenithAngle = acos(clamp(mu, -1.0, 1.0));

    var y: f32;
    if (viewZenithAngle < zenithHorizonAngle) {
        let t = viewZenithAngle / max(zenithHorizonAngle, 1e-6);
        y = (1.0 - sqrt(1.0 - t)) * 0.5;
    } else {
        let t = (viewZenithAngle - zenithHorizonAngle) / max(DK_PI - zenithHorizonAngle, 1e-6);
        y = sqrt(t) * 0.5 + 0.5;
    }

    // The sky is symmetric about the sun's meridian, so only half a turn of azimuth has to be stored.
    let x = sqrt(clamp(cosLightAzimuth * 0.5 + 0.5, 0.0, 1.0));

    return vec2f(dkUnitToTextureCoord(x, size.x), dkUnitToTextureCoord(y, size.y));
}

// uv in the sky-view LUT -> (mu, cos of the azimuth from the sun). The exact inverse of the above.
fn dkSkyViewMuAzimuth(a: DkAtmosphere, r: f32, uv: vec2f, size: vec2f) -> vec2f {
    let x = dkTextureToUnitCoord(uv.x, size.x);
    let y = dkTextureToUnitCoord(uv.y, size.y);

    let horizon = dkHorizonMu(a, r);
    let zenithHorizonAngle = acos(clamp(horizon, -1.0, 1.0));

    var viewZenithAngle: f32;
    if (y < 0.5) {
        let t = 1.0 - y * 2.0;
        viewZenithAngle = zenithHorizonAngle * (1.0 - t * t);
    } else {
        let t = (y - 0.5) * 2.0;
        viewZenithAngle = zenithHorizonAngle + (DK_PI - zenithHorizonAngle) * t * t;
    }

    return vec2f(cos(viewZenithAngle), clamp(x * x, 0.0, 1.0) * 2.0 - 1.0);
}
