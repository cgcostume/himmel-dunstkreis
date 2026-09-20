/**
 * Atmospheric refraction, as a correction to a view ray.
 *
 * This is the CPU twin of `wgsl/refraction.ts`; both implement the same fit and are pinned to each other by a
 * test. Having it here too lets a consumer do the correction on their own rays, and lets the shader's version
 * be verified without a screenshot.
 *
 * Refraction is deliberately not derived from the scattering model: it comes from air's refractive index,
 * scattering and absorption from its cross-sections, and neither follows from the other.
 */

const DEG_TO_RAD = Math.PI / 180;

/** Pressure scale height of the international standard atmosphere, in meters: R·T₀ / (M·g) at 288.15 K. */
export const PRESSURE_SCALE_HEIGHT_M = 8434.5;

/**
 * Air pressure at a height above sea level, relative to sea level. Thinner air bends light less, so this is
 * what makes refraction fall off with the observer's height and vanish at the top of the atmosphere.
 */
export function airPressureRatio(observerHeightM: number): number {
    return Math.exp(-observerHeightM / PRESSURE_SCALE_HEIGHT_M);
}

/** Local conditions at the observer. Both default to the ones the fit itself assumes. */
export interface RefractionConditions {
    /** Observer height above sea level, in meters. */
    observerHeightM?: number;
    /** Local air temperature, in degrees Celsius. */
    temperatureC?: number;
}

/**
 * Refraction, in degrees, as a function of the *apparent* altitude it produced, per Meeus' "Astronomical
 * Algorithms" (15.3) and G.G. Bennett, "The Calculation of the Astronomical Refraction in Marine Navigation"
 * (1982). ~34.5' at the horizon, 0 at the zenith.
 *
 * This is the direction a renderer needs, since a camera ray is by definition an apparent direction:
 * subtracting this from a ray's apparent altitude gives the true altitude to sample the sky at.
 * `@himmel/sternzeit`'s `earth.atmosphericRefraction` is the inverse relation (15.4, true to apparent), for
 * correcting a computed body position instead. Apply one or the other, never both.
 *
 * The fit is stated for apparent altitudes of 0 and up and has a pole at -4.4°, so the input is clamped at 0.
 */
export function atmosphericRefractionFromApparent(
    apparentAltitude: number,
    conditions: RefractionConditions = {},
): number {
    const { observerHeightM = 0, temperatureC = 10 } = conditions;
    const h = Math.max(apparentAltitude, 0);

    // The constant zeroes R at the zenith, which the bare fit misses by ~0.0014'.
    const R = 1 / Math.tan((h + 7.31 / (h + 4.4)) * DEG_TO_RAD) + 0.0013515216737563;

    // AA.15's P/1010 · 283/(273+T) scaling, as a multiplier that is exactly 1 at the fit's own conditions.
    return (R / 60) * airPressureRatio(observerHeightM) * (283 / (273 + temperatureC)); // R is in arcminutes.
}

/**
 * Warps an apparent (camera) view direction to the true direction to sample the sky at, in a right-handed
 * frame whose `z` is the local up. Returns a unit vector.
 *
 * Lowering every ray by its own refraction is what produces, from one function: bodies staying visible while
 * geometrically below the horizon, the whole sky compressing slightly near the horizon, and the vertical
 * flattening of the sun and moon there, which follows from the steep `dR/da` rather than needing the disc to
 * be special-cased.
 */
export function refractViewDirection(
    direction: readonly [number, number, number],
    conditions: RefractionConditions = {},
): [number, number, number] {
    const [x, y, z] = direction;

    const horizontal = Math.hypot(x, y);
    if (horizontal < 1e-9) return [x, y, Math.sign(z) || 1]; // straight up or down, nothing to bend

    const apparentAltitude = Math.atan2(z, horizontal) / DEG_TO_RAD;
    const trueAltitude =
        (apparentAltitude - atmosphericRefractionFromApparent(apparentAltitude, conditions)) * DEG_TO_RAD;

    const cosAltitude = Math.cos(trueAltitude);
    return [(x / horizontal) * cosAltitude, (y / horizontal) * cosAltitude, Math.sin(trueAltitude)];
}
