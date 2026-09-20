// Atmospheric refraction, the GPU twin of `src/refraction.ts`. Self-contained: it depends on nothing else in
// this package, not even the atmosphere uniform block, so the moon, star and cloud modules can paste it in on
// its own and warp their rays with exactly the same function the sky uses.
//
// Roughly 5 ALU operations plus one tan, evaluated once per pixel before any LUT sampling.

const DK_DEG_TO_RAD: f32 = 0.01745329251994330;
const DK_PRESSURE_SCALE_HEIGHT_M: f32 = 8434.5;

// Air pressure at a height above sea level, relative to sea level. Refraction scales with it, so it falls off
// with the observer's height and vanishes at the top of the atmosphere.
fn dkAirPressureRatio(observerHeightM: f32) -> f32 {
    return exp(-observerHeightM / DK_PRESSURE_SCALE_HEIGHT_M);
}

// Refraction, in degrees, as a function of the apparent altitude (degrees) that produced it. Meeus'
// "Astronomical Algorithms" (15.3) / Bennett (1982), with the trailing constant zeroing it at the zenith.
// The fit has a pole at -4.4 degrees, so the input is clamped at 0; rays below the horizontal are either
// ground or, for an elevated observer, within ~1 degree of the horizon, where that is a fine approximation.
fn dkAtmosphericRefractionFromApparent(apparentAltitude: f32, observerHeightM: f32, temperatureC: f32) -> f32 {
    let h = max(apparentAltitude, 0.0);
    let R = 1.0 / tan((h + 7.31 / (h + 4.4)) * DK_DEG_TO_RAD) + 0.0013515216737563;

    // AA.15's P/1010 * 283/(273+T) scaling, a multiplier that is exactly 1 at the fit's own conditions.
    return (R / 60.0) * dkAirPressureRatio(observerHeightM) * (283.0 / (273.0 + temperatureC));
}

// Warps an apparent (camera) view direction to the true direction to sample the sky at. `z` is local up.
// Lowering every ray by its own refraction yields, from this one function: bodies staying visible while
// geometrically below the horizon, the sky compressing slightly near the horizon, and the vertical flattening
// of the sun and moon there, which follows from the steep dR/da rather than special-casing the disc.
fn dkRefractViewDirection(direction: vec3f, observerHeightM: f32, temperatureC: f32) -> vec3f {
    let horizontal = length(direction.xy);
    if (horizontal < 1e-9) {
        return vec3f(direction.xy, select(1.0, sign(direction.z), direction.z != 0.0));
    }

    let apparentAltitude = atan2(direction.z, horizontal) / DK_DEG_TO_RAD;
    let refraction = dkAtmosphericRefractionFromApparent(apparentAltitude, observerHeightM, temperatureC);
    let trueAltitude = (apparentAltitude - refraction) * DK_DEG_TO_RAD;

    return vec3f(direction.xy / horizontal * cos(trueAltitude), sin(trueAltitude));
}
