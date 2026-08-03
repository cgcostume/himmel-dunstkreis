import { test, expect } from "@playwright/test";
import { DEFAULT_ATMOSPHERE_MODEL, DEFAULT_TEXTURE_CONFIG } from "../src/model.js";

test("default atmosphere model matches osgHimmel's defaults", () => {
  expect(DEFAULT_ATMOSPHERE_MODEL.rayleigh.scaleHeightKm).toBe(8);
  expect(DEFAULT_ATMOSPHERE_MODEL.mie.scaleHeightKm).toBe(6);
  expect(DEFAULT_ATMOSPHERE_MODEL.mie.g).toBe(0.6);
  expect(DEFAULT_ATMOSPHERE_MODEL.mie.betaExtinction[0]).toBeCloseTo(
    20e-3 / 0.9,
    10,
  );
});

test("default texture config matches osgHimmel's precompute resolution", () => {
  expect(DEFAULT_TEXTURE_CONFIG.transmittance).toEqual({
    width: 256,
    height: 64,
  });
  expect(DEFAULT_TEXTURE_CONFIG.inscatter).toEqual({
    resR: 32,
    resMu: 128,
    resMuS: 32,
    resNu: 8,
  });
});
