import { expect, test } from "@playwright/test";
import { atmosphereTopRadiusKm, DEFAULT_ATMOSPHERE_MODEL, DEFAULT_TEXTURE_CONFIG } from "../src/model.js";
import { DEFAULT_QUALITY, pipelineConstants } from "../src/quality.js";
import { ATMOSPHERE_UNIFORM_SIZE, atmosphereUniformData } from "../src/uniforms.js";
import { evaluateWgsl, gpuDevice, wgslSource } from "./gpu.js";

const model = DEFAULT_ATMOSPHERE_MODEL;
const Rg = model.planet.groundRadiusKm;
const Rt = atmosphereTopRadiusKm(model);
const common = wgslSource("common");
// The struct declaration, then the functions that take it. The model arrives as a uniform, exactly as it
// does in a real pass, so these tests exercise the shipped path rather than a test-only one.
const source = `${wgslSource("atmosphere")}\n${common}`;
const uniform = atmosphereUniformData(model);

/** Runs a WGSL expression over the given inputs, returning only the first component of each result. */
async function evaluate(expression: string, inputs: readonly (readonly [number, number])[]): Promise<number[]> {
    const device = await gpuDevice();
    if (!device) return [];

    const results = await evaluateWgsl(
        device,
        source,
        expression,
        inputs.map(([a, b]) => [a, b, 0, 0] as [number, number, number, number]),
        { atmosphere: uniform },
    );
    return results.map((r) => r[0]);
}

test("the uniform packing matches the DkAtmosphere struct field for field", () => {
    // Nothing in the toolchain connects the WGSL struct to the TypeScript that fills its buffer, so the one
    // thing that would silently corrupt every shader is these two drifting apart. Parse the struct and check
    // the packing writes the expected value at each field's offset.
    const struct = wgslSource("atmosphere").slice(wgslSource("atmosphere").indexOf("struct DkAtmosphere"));
    const fields = [...struct.matchAll(/^\s{4}(\w+):\s*(vec3f|f32),/gm)].map(
        (m) => [m[1] as string, m[2] as string] as const,
    );

    expect(fields.map(([name]) => name)).toEqual([
        "betaR",
        "Rg",
        "betaMSca",
        "Rt",
        "betaMEx",
        "mieG",
        "betaOAbs",
        "HR",
        "solarIrradiance",
        "HM",
        "ozoneCenter",
        "ozoneHalfWidth",
        "avgGroundReflectance",
        "_padding",
    ]);

    const data = atmosphereUniformData(model);
    expect(data.byteLength).toBe(ATMOSPHERE_UNIFORM_SIZE);

    const expected: Record<string, number | readonly number[]> = {
        betaR: model.rayleigh.beta,
        Rg: model.planet.groundRadiusKm,
        betaMSca: model.mie.betaScattering,
        Rt: atmosphereTopRadiusKm(model),
        betaMEx: model.mie.betaExtinction,
        mieG: model.mie.g,
        betaOAbs: model.ozone.betaAbsorption,
        HR: model.rayleigh.scaleHeightKm,
        solarIrradiance: model.solarIrradiance,
        HM: model.mie.scaleHeightKm,
        ozoneCenter: model.ozone.centerAltitudeKm,
        ozoneHalfWidth: model.ozone.widthKm / 2,
        avgGroundReflectance: model.avgGroundReflectance,
        _padding: 0,
    };

    // Walk the struct applying WGSL's uniform layout rules: vec3f has size 12 but alignment 16, which is
    // exactly the packing the scalars in the tails rely on.
    let offset = 0;
    for (const [name, type] of fields) {
        if (type === "vec3f") {
            offset = Math.ceil(offset / 4) * 4;
            const actual = Array.from(data.slice(offset, offset + 3));
            // Float32Array, so the f64 model values land rounded. Math.fround is that exact rounding, which
            // makes this a strict equality rather than a tolerance that could hide a genuine mismatch.
            (expected[name] as number[]).forEach((v, c) => expect(actual[c], `${name}.${c}`).toBe(Math.fround(v)));
            offset += 3;
        } else {
            expect(data[offset], name).toBe(Math.fround(expected[name] as number));
            offset += 1;
        }
    }
    expect(offset).toBe(ATMOSPHERE_UNIFORM_SIZE / 4);
});

test("pipelineConstants names exactly the overrides quality.wgsl declares", () => {
    // Mismatched keys make pipeline creation fail at runtime, well after typechecking has passed, so the two
    // lists are pinned here instead.
    const declared = [...wgslSource("quality").matchAll(/^override\s+(\w+)\s*:/gm)].map((m) => m[1] as string);
    const provided = Object.keys(pipelineConstants(DEFAULT_TEXTURE_CONFIG));

    expect(new Set(provided)).toEqual(new Set(declared));
    expect(provided).toEqual(Object.keys(DEFAULT_QUALITY));
});

test("pipelineConstants carries the configured sample counts and the refraction switch", () => {
    const constants = pipelineConstants(DEFAULT_TEXTURE_CONFIG);

    expect(constants.DK_SAMPLES_TRANSMITTANCE).toBe(DEFAULT_TEXTURE_CONFIG.integralSamples.transmittance);
    expect(constants.DK_SAMPLES_SKY_VIEW).toBe(DEFAULT_TEXTURE_CONFIG.integralSamples.skyView);
    expect(constants.DK_REFRACTION).toBe(1);
    expect(pipelineConstants(DEFAULT_TEXTURE_CONFIG, { refraction: false }).DK_REFRACTION).toBe(0);
});

test("ray-sphere distances are consistent from the ground and from the top", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    // Straight up from the ground is exactly the shell thickness; straight down from the top likewise.
    const [upFromGround, downFromTop, grazing] = await evaluate(
        "vec4f(dkDistanceToTopAtmosphereBoundary(atmosphere, input.x, input.y))",
        [
            [Rg, 1],
            [Rt, -1],
            [Rg, 0],
        ],
    );

    expect(upFromGround).toBeCloseTo(Rt - Rg, 2);
    // Straight down from the top is 2*Rt, the far intersection: this is pure ray-sphere geometry and knows
    // nothing about the ground being in the way, which is why callers check dkIntersectsGround first.
    expect(downFromTop).toBeCloseTo(2 * Rt, 0);
    // A horizontal ray at the ground travels much further than the vertical thickness: the airmass effect.
    expect(grazing as number).toBeGreaterThan((Rt - Rg) * 8);
    expect(grazing as number).toBeCloseTo(Math.sqrt(Rt * Rt - Rg * Rg), 1);
});

test("the horizon cosine and the ground-intersection test agree", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    // At the ground the horizon is exactly horizontal; higher up it dips below, by ~1 degree at 1 km.
    const [atGround, at1km] = await evaluate("vec4f(dkHorizonMu(atmosphere, input.x))", [
        [Rg, 0],
        [Rg + 1, 0],
    ]);
    expect(atGround).toBeCloseTo(0, 6);
    expect((Math.acos(at1km as number) * 180) / Math.PI - 90).toBeCloseTo(1.02, 1);

    // Just below the horizon hits ground, just above does not.
    const r = Rg + 1;
    const mu = at1km as number;
    const [below, above] = await evaluate("vec4f(select(0.0, 1.0, dkIntersectsGround(atmosphere, input.x, input.y)))", [
        [r, mu - 1e-4],
        [r, mu + 1e-4],
    ]);
    expect(below).toBe(1);
    expect(above).toBe(0);
});

test("density profiles follow their layers", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    const [rayleighGround, rayleighScale, mieGround, mieScale] = await evaluate(
        "vec4f(select(dkDensityRayleigh(atmosphere, input.x), dkDensityMie(atmosphere, input.x), input.y > 0.5))",
        [
            [0, 0],
            [model.rayleigh.scaleHeightKm, 0],
            [0, 1],
            [model.mie.scaleHeightKm, 1],
        ],
    );

    // Both are 1 at sea level and 1/e at their own scale height, which is the definition of a scale height.
    expect(rayleighGround).toBeCloseTo(1, 6);
    expect(mieGround).toBeCloseTo(1, 6);
    expect(rayleighScale).toBeCloseTo(Math.E ** -1, 5);
    expect(mieScale).toBeCloseTo(Math.E ** -1, 5);

    // Ozone is a tent, not an exponential: zero at the ground, peaking at its centre altitude.
    const [ozoneGround, ozoneCentre, ozoneEdge] = await evaluate("vec4f(dkDensityOzone(atmosphere, input.x))", [
        [0, 0],
        [model.ozone.centerAltitudeKm, 0],
        [model.ozone.centerAltitudeKm + model.ozone.widthKm / 2, 0],
    ]);
    expect(ozoneGround).toBeCloseTo(0, 6);
    expect(ozoneCentre).toBeCloseTo(1, 6);
    expect(ozoneEdge).toBeCloseTo(0, 6);
});

test("both phase functions integrate to 1 over the sphere", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    // A phase function redistributes light, it does not create or destroy it, so its integral over all
    // outgoing directions must be exactly 1. This catches a dropped normalization factor in either one.
    const steps = 4000; // one dispatch, see MAX_INPUTS in gpu.ts; plenty for three decimal places
    const inputs = Array.from({ length: steps }, (_, i) => [-1 + (2 * (i + 0.5)) / steps, 0] as const);

    for (const [name, expression] of [
        ["Rayleigh", "vec4f(dkPhaseRayleigh(input.x))"],
        ["Mie", "vec4f(dkPhaseMie(atmosphere, input.x))"],
    ] as const) {
        const values = await evaluate(expression, inputs);
        const integral = values.reduce((sum, v) => sum + v, 0) * ((2 / steps) * 2 * Math.PI);

        expect(integral, `${name} phase function`).toBeCloseTo(1, 3);
    }
});

test("the Mie phase function is forward-biased and the Rayleigh one is symmetric", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    const [rayleighFwd, rayleighBack, mieFwd, mieBack, mieSide] = await evaluate(
        "vec4f(select(dkPhaseRayleigh(input.x), dkPhaseMie(atmosphere, input.x), input.y > 0.5))",
        [
            [1, 0],
            [-1, 0],
            [1, 1],
            [-1, 1],
            [0, 1],
        ],
    );

    expect(rayleighFwd).toBeCloseTo(rayleighBack as number, 6);
    // g = 0.8 puts most of the Mie energy in a tight forward lobe: the glow around the sun.
    expect(mieFwd as number).toBeGreaterThan((mieBack as number) * 100);
    expect(mieFwd as number).toBeGreaterThan((mieSide as number) * 10);
});

test("overrides reach the shader and specialize it", async () => {
    const device = await gpuDevice();
    test.skip(device === null, "GPU tests disabled; run pnpm test:gpu");
    if (!device) return;

    // Proves the override plumbing end to end: same module, two pipelines, different compiled-in values.
    // This is the mechanism the quality presets and the refraction switch ride on, so that loop bounds stay
    // compile-time constants and a disabled feature leaves no code behind rather than branching per pixel.
    const source = wgslSource("quality");
    const expression = "vec4f(f32(DK_SAMPLES_SKY_VIEW), select(0.0, 1.0, DK_REFRACTION), 0.0, 0.0)";
    const input: [number, number, number, number] = [0, 0, 0, 0];

    const [on] = await evaluateWgsl(device, source, expression, [input], {
        constants: pipelineConstants(DEFAULT_TEXTURE_CONFIG),
    });
    const [off] = await evaluateWgsl(device, source, expression, [input], {
        constants: pipelineConstants(DEFAULT_TEXTURE_CONFIG, { refraction: false }),
    });

    expect(on?.[0]).toBe(DEFAULT_TEXTURE_CONFIG.integralSamples.skyView);
    expect(on?.[1]).toBe(1);
    expect(off?.[1]).toBe(0);

    // And the declared defaults apply when nothing is passed.
    const [fallback] = await evaluateWgsl(device, source, expression, [input]);
    expect(fallback?.[0]).toBe(DEFAULT_QUALITY.DK_SAMPLES_SKY_VIEW);
});
