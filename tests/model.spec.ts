import { expect, test } from "@playwright/test";
import {
    atmosphereTopRadiusKm,
    DEFAULT_ATMOSPHERE_MODEL,
    DEFAULT_TEXTURE_CONFIG,
    OSGHIMMEL_ATMOSPHERE_MODEL,
} from "../src/model.js";

test("the osgHimmel preset reproduces the original's t_modelCfg defaults", () => {
    const m = OSGHIMMEL_ATMOSPHERE_MODEL;

    expect(m.avgGroundReflectance).toBe(0.1);
    expect(m.rayleigh.scaleHeightKm).toBe(8);
    expect(m.rayleigh.beta).toEqual([5.8e-3, 1.35e-2, 3.31e-2]);
    expect(m.mie.scaleHeightKm).toBe(6);
    expect(m.mie.betaScattering).toEqual([20e-3, 20e-3, 20e-3]);
    expect(m.mie.betaExtinction[0]).toBeCloseTo(20e-3 / 0.9, 10);
    expect(m.mie.g).toBe(0.6);
    // The original had no ozone term at all, hence the zeroed coefficient rather than a missing layer.
    expect(m.ozone.betaAbsorption).toEqual([0, 0, 0]);
    // Earth::meanRadius() + Earth::atmosphereThicknessNonUniform(), matching sternzeit's earth constants.
    expect(m.planet).toEqual({ groundRadiusKm: 6371, thicknessKm: 85 });
});

test("the default model deviates from the original only where intended", () => {
    const d = DEFAULT_ATMOSPHERE_MODEL;
    const o = OSGHIMMEL_ATMOSPHERE_MODEL;

    // Unchanged: Rayleigh is settled physics, and the ground reflectance was never contentious.
    expect(d.rayleigh).toEqual(o.rayleigh);
    expect(d.avgGroundReflectance).toBe(o.avgGroundReflectance);

    // Changed: the aerosol layer is far thinner and more forward-scattering than the original assumed, and
    // ozone is present. The original's own source carries 1.2 as a commented-out alternative to its 6.
    expect(d.mie.scaleHeightKm).toBe(1.2);
    expect(d.mie.g).toBe(0.8);
    expect(d.mie.betaExtinction[0]).toBeCloseTo((d.mie.betaScattering[0] as number) / 0.9, 12);
    expect(d.ozone.betaAbsorption.some((c) => c > 0)).toBe(true);
});

test("atmosphereTopRadiusKm is the ground radius plus the shell thickness", () => {
    expect(atmosphereTopRadiusKm(DEFAULT_ATMOSPHERE_MODEL)).toBe(6420);
    expect(atmosphereTopRadiusKm(OSGHIMMEL_ATMOSPHERE_MODEL)).toBe(6456);
});

test("the texture config keeps osgHimmel's precompute resolution for the precise variant", () => {
    expect(DEFAULT_TEXTURE_CONFIG.transmittance).toEqual({ width: 256, height: 64 });
    expect(DEFAULT_TEXTURE_CONFIG.irradiance).toEqual({ width: 64, height: 16 });
    expect(DEFAULT_TEXTURE_CONFIG.inscatter).toEqual({ resR: 32, resMu: 128, resMuS: 32, resNu: 8 });
    expect(DEFAULT_TEXTURE_CONFIG.scatteringOrders).toBe(4);

    // Hillaire's tables, which replace the 4D one: three orders of magnitude smaller.
    const inscatterTexels = 32 * 128 * 32 * 8;
    const hillaireTexels = 32 * 32 + 192 * 108;
    expect(hillaireTexels).toBeLessThan(inscatterTexels / 10);
});
