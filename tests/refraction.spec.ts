import { earth } from "@himmel/sternzeit";
import { expect, test } from "@playwright/test";
import { atmosphericRefractionFromApparent, refractViewDirection } from "../src/refraction.js";
import { evaluateWgsl, gpuDevice, wgslSource } from "./gpu.js";

const refraction = wgslSource("refraction");
const ALTITUDES = [0, 0.25, 0.5, 1, 2, 5, 10, 20, 45, 70, 89, 90];

test("refraction is ~34.5' at the horizon and 0 at the zenith", () => {
    // More than the Sun's own ~32' apparent diameter, which is why a Sun that looks like it is touching the
    // horizon has geometrically already set. This is AA.15.3, distinct from sternzeit's 15.4 (~29').
    expect(atmosphericRefractionFromApparent(0) * 60).toBeCloseTo(34.48, 2);
    expect(atmosphericRefractionFromApparent(90) * 60).toBeCloseTo(0, 6);
});

test("refraction is the inverse of sternzeit's true-altitude fit", () => {
    // The pairing the whole split depends on: sternzeit lifts a true altitude to apparent for consumers
    // correcting a body position, this package takes an apparent camera ray back to true. Round-tripping must
    // land where it started. Independent empirical fits, so they agree to arcseconds rather than exactly.
    for (const trueAltitude of ALTITUDES) {
        const apparent = trueAltitude + earth.atmosphericRefraction(trueAltitude);
        const back = apparent - atmosphericRefractionFromApparent(apparent);

        expect(Math.abs(back - trueAltitude) * 3600).toBeLessThan(5); // arcseconds
    }
});

test("refraction matches sternzeit's own copy of the same fit exactly", () => {
    // sternzeit carries a TypeScript twin for GPU-less consumers. Deliberate duplication of a two-line
    // formula across decoupled packages, so it has to be pinned rather than trusted.
    for (const altitude of ALTITUDES) {
        expect(atmosphericRefractionFromApparent(altitude)).toBeCloseTo(
            earth.atmosphericRefractionFromApparent(altitude),
            15,
        );
    }
});

test("refraction falls off with observer height and rises in colder air", () => {
    expect(atmosphericRefractionFromApparent(0, { observerHeightM: 1000 }) * 60).toBeCloseTo(34.48 * 0.8882, 1);
    expect(atmosphericRefractionFromApparent(0, { observerHeightM: 60_000 })).toBeLessThan(1e-3);
    expect(atmosphericRefractionFromApparent(0, { temperatureC: -20 })).toBeGreaterThan(
        atmosphericRefractionFromApparent(0, { temperatureC: 30 }),
    );
});

test("refractViewDirection lowers rays and flattens the disc near the horizon", () => {
    const altitudeOf = (d: readonly [number, number, number]) => (Math.asin(d[2]) * 180) / Math.PI;
    const ray = (altitudeDeg: number): [number, number, number] => {
        const a = (altitudeDeg * Math.PI) / 180;
        return [Math.cos(a), 0, Math.sin(a)];
    };

    // Every ray is lowered, and the returned direction stays a unit vector.
    for (const a of ALTITUDES) {
        const warped = refractViewDirection(ray(a));
        expect(Math.hypot(...warped)).toBeCloseTo(1, 6);
        expect(altitudeOf(warped)).toBeLessThanOrEqual(a + 1e-9);
    }

    // The flattening, which the original never had. The warp runs apparent -> true, and because dR/da is
    // steep near the horizon it spreads an apparent span into a wider true one. Inverted, that is the visible
    // effect: the Sun's ~32' of *true* angular size is squeezed into less than 32' of apparent sky, so the
    // disc reads as an ellipse. Measured here through the warp itself rather than through its inverse.
    const sunRadius = 32 / 60 / 2;
    const flattening = (centre: number) =>
        (2 * sunRadius) /
        (altitudeOf(refractViewDirection(ray(centre + sunRadius))) -
            altitudeOf(refractViewDirection(ray(centre - sunRadius))));

    expect(flattening(0.5)).toBeCloseTo(0.856, 3); // at the horizon: ~14% flatter than it is wide
    expect(flattening(45)).toBeGreaterThan(0.999); // high up: essentially circular
    expect(flattening(0.5)).toBeLessThan(flattening(10)); // and it grows steadily as the Sun sets
});

test("the WGSL refraction matches its TypeScript twin", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    const conditions = { observerHeightM: 1200, temperatureC: -3 };
    const inputs = ALTITUDES.map(
        (a) => [a, conditions.observerHeightM, conditions.temperatureC, 0] as [number, number, number, number],
    );

    const results = await evaluateWgsl(
        device,
        refraction,
        "vec4f(dkAtmosphericRefractionFromApparent(input.x, input.y, input.z), 0.0, 0.0, 0.0)",
        inputs,
    );

    ALTITUDES.forEach((altitude, i) => {
        // f32 on the GPU against f64 in TypeScript, so agreement is to float precision, not to the bit.
        expect(results[i]?.[0]).toBeCloseTo(atmosphericRefractionFromApparent(altitude, conditions), 6);
    });
});

test("the WGSL ray warp matches its TypeScript twin", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    const directions: [number, number, number, number][] = [];
    for (const altitude of [-30, -1, 0, 0.5, 2, 10, 45, 89.9]) {
        for (const azimuth of [0, 37, 180, 300]) {
            const a = (altitude * Math.PI) / 180;
            const z = (azimuth * Math.PI) / 180;
            directions.push([Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a), 0]);
        }
    }
    directions.push([0, 0, 1, 0]); // straight up, the degenerate case the warp special-cases

    const results = await evaluateWgsl(
        device,
        refraction,
        "vec4f(dkRefractViewDirection(input.xyz, 0.0, 10.0), 0.0)",
        directions,
    );

    directions.forEach(([x, y, z], i) => {
        const expected = refractViewDirection([x, y, z]);
        const actual = results[i] as [number, number, number, number];

        for (let c = 0; c < 3; ++c) expect(actual[c]).toBeCloseTo(expected[c] as number, 5);
    });
});
