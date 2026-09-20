import { type AtmosphereModel, atmosphereTopRadiusKm } from "./model.js";

/**
 * Size of the `DkAtmosphere` uniform block, in bytes. Scalars are packed into the tails of the vec3s, which
 * WGSL's 16-byte vec3 alignment leaves free, so the whole model fits in 96 bytes.
 */
export const ATMOSPHERE_UNIFORM_SIZE = 96;

/**
 * Packs a model into the `DkAtmosphere` layout declared by `wgsl/atmosphere.wgsl`, ready for `writeBuffer`.
 * The field order here mirrors that struct exactly and a test pins the two together, since nothing in the
 * toolchain would otherwise catch them drifting apart.
 *
 * Pass `target` to write into an existing buffer, e.g. a subrange of a larger uniform block of your own.
 */
export function atmosphereUniformData(model: AtmosphereModel, target?: Float32Array): Float32Array {
    const data = target ?? new Float32Array(ATMOSPHERE_UNIFORM_SIZE / 4);

    data.set(model.rayleigh.beta, 0);
    data[3] = model.planet.groundRadiusKm;

    data.set(model.mie.betaScattering, 4);
    data[7] = atmosphereTopRadiusKm(model);

    data.set(model.mie.betaExtinction, 8);
    data[11] = model.mie.g;

    data.set(model.ozone.betaAbsorption, 12);
    data[15] = model.rayleigh.scaleHeightKm;

    data.set(model.solarIrradiance, 16);
    data[19] = model.mie.scaleHeightKm;

    data[20] = model.ozone.centerAltitudeKm;
    data[21] = model.ozone.widthKm / 2;
    data[22] = model.avgGroundReflectance;
    data[23] = 0; // _padding

    return data;
}
