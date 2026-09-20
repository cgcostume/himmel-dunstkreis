/**
 * Geometry of the planet and its atmosphere. The atmosphere is the shell between `groundRadiusKm` and
 * `groundRadiusKm + thicknessKm`, and the observer must be inside it: views from space are not supported.
 */
export interface PlanetGeometry {
    /** Radius of the ground, in km. `Rg` in the original shaders. */
    groundRadiusKm: number;
    /** Thickness of the atmosphere shell, in km, so the top is at `groundRadiusKm + thicknessKm` (`Rt`). */
    thicknessKm: number;
}

/** An exponentially decaying density layer, the profile both Rayleigh and Mie scattering follow. */
export interface ExponentialLayer {
    /** Altitude over which the layer's density falls by a factor of e, in km. */
    scaleHeightKm: number;
}

/**
 * A tent-shaped density layer, peaking at `centerAltitudeKm` and falling linearly to zero `widthKm / 2` above
 * and below it. Ozone follows this rather than an exponential, since it is produced by UV in the stratosphere
 * rather than settling out of the air like aerosols.
 */
export interface TentLayer {
    centerAltitudeKm: number;
    widthKm: number;
}

/**
 * Physical parameters of the atmosphere. Shared by both variants (Bruneton and Hillaire): they differ in how
 * they integrate this model, not in the model itself.
 *
 * Coefficients are per RGB channel and in `1/km`, at sea level. They are wavelength-dependent in reality, so
 * an RGB triple is already an approximation of a spectral quantity, picked for (680, 550, 440) nm.
 */
export interface AtmosphereModel {
    planet: PlanetGeometry;
    /**
     * Irradiance arriving at the top of the atmosphere, per channel. Only the ratios between channels and the
     * overall scale matter; everything downstream is linear in this.
     */
    solarIrradiance: readonly [number, number, number];
    /** Average ground reflectance, used for the irradiance ping-pong pass. */
    avgGroundReflectance: number;
    rayleigh: ExponentialLayer & {
        /** Rayleigh scattering coefficient. Equals the extinction coefficient: air molecules do not absorb. */
        beta: readonly [number, number, number];
    };
    mie: ExponentialLayer & {
        /** Mie scattering coefficient. */
        betaScattering: readonly [number, number, number];
        /** Mie extinction coefficient, i.e. scattering plus absorption, so always >= `betaScattering`. */
        betaExtinction: readonly [number, number, number];
        /** Cornette-Shanks asymmetry factor, in [-1, +1]. Positive is forward-scattering, the physical case. */
        g: number;
    };
    ozone: TentLayer & {
        /** Ozone absorption coefficient. Ozone only absorbs, so there is no scattering counterpart. */
        betaAbsorption: readonly [number, number, number];
    };
}

/**
 * Earth. The defaults are the modern consensus values rather than a literal copy of osgHimmel's, which
 * predate both the ozone term and the now-standard aerosol scale height; see `OSGHIMMEL_ATMOSPHERE_MODEL` to
 * reproduce the original exactly.
 */
export const DEFAULT_ATMOSPHERE_MODEL: AtmosphereModel = {
    planet: { groundRadiusKm: 6360, thicknessKm: 60 },
    solarIrradiance: [1.474, 1.8504, 1.91198],
    avgGroundReflectance: 0.1,
    rayleigh: {
        scaleHeightKm: 8,
        // Bucholtz, "Rayleigh-scattering calculations for the terrestrial atmosphere" (1995).
        beta: [5.8e-3, 1.35e-2, 3.31e-2],
    },
    mie: {
        // 1.2 km, not osgHimmel's 6: aerosols hug the ground far more tightly than air itself does. The
        // original's own source has `6.f; //1.2f`, i.e. this value was the commented-out alternative there.
        scaleHeightKm: 1.2,
        betaScattering: [3e-3, 3e-3, 3e-3],
        // The usual single-scattering albedo of 0.9 for atmospheric aerosols, i.e. a tenth is absorbed.
        betaExtinction: [3e-3 / 0.9, 3e-3 / 0.9, 3e-3 / 0.9],
        g: 0.8,
    },
    ozone: {
        // Absent from osgHimmel entirely. Without it twilight goes gray instead of deep blue, because nothing
        // else removes the green-yellow band from the long, low-sun paths.
        centerAltitudeKm: 25,
        widthKm: 30,
        betaAbsorption: [6.5e-4, 1.881e-3, 8.5e-5],
    },
};

/**
 * osgHimmel's `t_modelCfg` defaults verbatim, for A/B-ing this port against the original. Note the thicker
 * Mie layer, the weaker forward scattering, the much stronger Mie coefficient, and the absent ozone.
 */
export const OSGHIMMEL_ATMOSPHERE_MODEL: AtmosphereModel = {
    ...DEFAULT_ATMOSPHERE_MODEL,
    // osgHimmel drove these from `Earth::meanRadius()` and `Earth::atmosphereThicknessNonUniform()`.
    planet: { groundRadiusKm: 6371, thicknessKm: 85 },
    mie: {
        scaleHeightKm: 6,
        betaScattering: [20e-3, 20e-3, 20e-3],
        betaExtinction: [20e-3 / 0.9, 20e-3 / 0.9, 20e-3 / 0.9],
        g: 0.6,
    },
    ozone: { centerAltitudeKm: 25, widthKm: 30, betaAbsorption: [0, 0, 0] },
};

/**
 * Resolution and sampling configuration for the precomputed LUTs. The original generated these via multi-pass
 * FBO renders; here they become compute shader dispatch and storage texture sizes.
 *
 * `transmittance` is shared by both variants. `irradiance`/`inscatter` belong to Bruneton, `multiScattering`
 * and `skyView` to Hillaire; each variant ignores the other's fields.
 */
export interface PrecomputedTextureConfig {
    transmittance: { width: number; height: number };
    irradiance: { width: number; height: number };
    /** Dimensions of Bruneton's 4D inscatter LUT (r, mu, muS, nu), packed into a 3D texture. */
    inscatter: { resR: number; resMu: number; resMuS: number; resNu: number };
    /** Number of scattering orders Bruneton's algorithm 4.1 iterates. osgHimmel used 4. */
    scatteringOrders: number;
    /** Hillaire's multiple-scattering LUT (r, muS), which replaces the 4D inscatter table entirely. */
    multiScattering: { width: number; height: number };
    /** Hillaire's per-frame sky-view LUT, over view direction with a horizon-biased latitude mapping. */
    skyView: { width: number; height: number };
    integralSamples: {
        transmittance: number;
        inscatter: number;
        irradiance: number;
        inscatterSpherical: number;
        multiScattering: number;
        skyView: number;
    };
}

export const DEFAULT_TEXTURE_CONFIG: PrecomputedTextureConfig = {
    transmittance: { width: 256, height: 64 },
    irradiance: { width: 64, height: 16 },
    inscatter: { resR: 32, resMu: 128, resMuS: 32, resNu: 8 },
    scatteringOrders: 4,
    multiScattering: { width: 32, height: 32 },
    skyView: { width: 192, height: 108 },
    integralSamples: {
        transmittance: 500,
        inscatter: 50,
        irradiance: 32,
        inscatterSpherical: 16,
        multiScattering: 20,
        skyView: 30,
    },
};

/** Radius of the top of the atmosphere, in km, i.e. `Rt`. */
export function atmosphereTopRadiusKm(model: AtmosphereModel): number {
    return model.planet.groundRadiusKm + model.planet.thicknessKm;
}
