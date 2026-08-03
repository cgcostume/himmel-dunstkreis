/**
 * Physical parameters of the Bruneton et al. precomputed atmospheric
 * scattering model (Earth-like atmosphere, wavelengths implicit in the
 * RGB scattering coefficients).
 */
export interface AtmosphereModel {
    /** Average ground reflectance, used for the irradiance ping-pong pass. */
    avgGroundReflectance: number;
    rayleigh: {
        /** Scale height of the Rayleigh density layer, in km. */
        scaleHeightKm: number;
        /** Rayleigh scattering coefficient (== extinction coefficient), per km. */
        beta: readonly [number, number, number];
    };
    mie: {
        /** Scale height of the Mie density layer, in km. */
        scaleHeightKm: number;
        /** Mie scattering coefficient, per km. */
        betaScattering: readonly [number, number, number];
        /** Mie extinction coefficient, per km. */
        betaExtinction: readonly [number, number, number];
        /** Henyey-Greenstein asymmetry factor (forward-scattering bias). */
        g: number;
    };
}

export const DEFAULT_ATMOSPHERE_MODEL: AtmosphereModel = {
    avgGroundReflectance: 0.1,
    rayleigh: {
        scaleHeightKm: 8,
        beta: [5.8e-3, 1.35e-2, 3.31e-2],
    },
    mie: {
        scaleHeightKm: 6,
        betaScattering: [20e-3, 20e-3, 20e-3],
        betaExtinction: [20e-3 / 0.9, 20e-3 / 0.9, 20e-3 / 0.9],
        g: 0.6,
    },
};

/**
 * Resolution/sampling configuration for the precomputed LUTs. The
 * original generated these via multi-pass FBO renders; here they become
 * compute shader dispatch/storage-texture sizes.
 */
export interface PrecomputedTextureConfig {
    transmittance: { width: number; height: number };
    sky: { width: number; height: number };
    /** Dimensions of the 3D inscatter LUT (r, mu, muS, nu). */
    inscatter: { resR: number; resMu: number; resMuS: number; resNu: number };
    integralSamples: {
        transmittance: number;
        inscatter: number;
        irradiance: number;
        inscatterSpherical: number;
    };
}

export const DEFAULT_TEXTURE_CONFIG: PrecomputedTextureConfig = {
    transmittance: { width: 256, height: 64 },
    sky: { width: 64, height: 16 },
    inscatter: { resR: 32, resMu: 128, resMuS: 32, resNu: 8 },
    integralSamples: {
        transmittance: 500,
        inscatter: 50,
        irradiance: 32,
        inscatterSpherical: 16,
    },
};
