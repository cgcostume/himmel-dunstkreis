/**
 * A minimal WebGPU harness for the tests, backed by Dawn through the `webgpu` package rather than a browser.
 *
 * Playwright's bundled Chromium has no `navigator.gpu` at all, in any launch mode or behind any flag, so
 * browser-based GPU tests would need a system Chrome that CI may or may not have. Dawn in-process avoids
 * that: these stay plain Playwright tests that never touch the `page` fixture, while executing real,
 * compiled WGSL.
 *
 * Opt-in, via DUNSTKREIS_GPU=1 (`pnpm test:gpu`). The `webgpu` package is not reliable enough to gate the
 * suite on: it aborts or deadlocks the process in roughly one run in three, in plain node as much as under
 * Playwright, regardless of the shader or the workload size. Rather than let that flake the whole suite,
 * the GPU tests skip by default and the pure-TypeScript tests carry the baseline. Run them explicitly when
 * touching WGSL, and re-evaluate making them default if the binding stabilizes.
 */
import { readFileSync } from "node:fs";

/**
 * Reads a shader by name from `src/wgsl/`. The tests load the `.wgsl` files directly rather than importing
 * the `src/wgsl/*.ts` wrappers, because those go through the rolldown plugin that inlines them and the test
 * runner has no equivalent. Same bytes either way, so this still tests the shipped shader.
 */
export function wgslSource(name: string): string {
    return readFileSync(new URL(`../src/wgsl/${name}.wgsl`, import.meta.url), "utf8");
}

let devicePromise: Promise<GPUDevice | null> | undefined;

/** True when the GPU tests are enabled. See the note above. */
export const GPU_ENABLED = process.env.DUNSTKREIS_GPU === "1";

/** The shared test device, or null if the GPU tests are disabled or no adapter is available. */
export function gpuDevice(): Promise<GPUDevice | null> {
    devicePromise ??= (async () => {
        if (!GPU_ENABLED) return null;

        // Imported lazily so a default run never loads the native binding at all.
        const { create, globals } = await import("webgpu");
        Object.assign(globalThis, globals);

        const adapter = await create([]).requestAdapter();
        if (!adapter) return null;

        return adapter.requestDevice();
    })();

    return devicePromise;
}

/**
 * Compiles `source` plus a generated entry point that evaluates `expression` once per input, and returns the
 * results. `expression` sees the input as `input`, a `vec4f`, and must evaluate to a `vec4f`.
 *
 * This keeps a test to the shape "here is a WGSL expression, here are inputs, here are the outputs", so the
 * WGSL under test can be compared against its TypeScript twin value by value.
 *
 * `options.atmosphere` binds a `DkAtmosphere` uniform, exposed to the expression as `atmosphere`, the same
 * way a real pass would: the tests exercise the uniform path rather than a separate baked-constant one, so
 * what they verify is what ships. `options.constants` sets pipeline overrides.
 *
 * Capped at one dispatch over one set of resources. The Dawn binding is not robust under churn: repeatedly
 * creating shader modules and buffers aborts the process non-deterministically, and repeatedly mapping one
 * buffer deadlocks it. Both are properties of the binding, not of any shader under test, so the harness
 * simply stays inside what it handles reliably and refuses anything larger.
 */
export const MAX_INPUTS = 4096;

export interface EvaluateOptions {
    /** Packed `DkAtmosphere` data; the source must declare the struct. Bound as `atmosphere`. */
    atmosphere?: Float32Array;
    /** Pipeline-overridable constants, for `override` declarations in the source. */
    constants?: Record<string, number>;
}

export async function evaluateWgsl(
    device: GPUDevice,
    source: string,
    expression: string,
    inputs: readonly (readonly [number, number, number, number])[],
    options: EvaluateOptions = {},
): Promise<[number, number, number, number][]> {
    const count = inputs.length;
    if (count === 0) return [];
    if (count > MAX_INPUTS) {
        throw new Error(`evaluateWgsl takes at most ${MAX_INPUTS} inputs, got ${count}`);
    }

    const byteLength = count * 4 * 4;

    const atmosphereBinding = options.atmosphere ? "@group(0) @binding(2) var<uniform> atmosphere: DkAtmosphere;" : "";

    const module = device.createShaderModule({
        code: `${source}
@group(0) @binding(0) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4f>;
${atmosphereBinding}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= ${count}u) { return; }
    let input = inputs[id.x];
    outputs[id.x] = ${expression};
}`,
    });

    // Surfaces WGSL compile errors as test failures with the shader log, rather than as a later validation
    // error on a pipeline that is missing its entry point.
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
        throw new Error(`WGSL compilation failed:\n${errors.map((m) => `  ${m.lineNum}: ${m.message}`).join("\n")}`);
    }

    const inputBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(inputBuffer, 0, new Float32Array(inputs.flat()));

    const outputBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    let atmosphereBuffer: GPUBuffer | undefined;
    if (options.atmosphere) {
        atmosphereBuffer = device.createBuffer({
            size: options.atmosphere.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(atmosphereBuffer, 0, options.atmosphere);
    }

    // An explicit layout rather than "auto", because "auto" derives the layout from what the shader actually
    // uses: an expression that ignores the atmosphere uniform would drop binding 2, and creating a bind group
    // with an entry the layout does not have fails validation. Declaring it makes the layout independent of
    // the expression under test.
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ...(atmosphereBuffer
                ? [{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" as const } }]
                : []),
        ],
    });

    const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: {
            module,
            entryPoint: "main",
            ...(options.constants ? { constants: options.constants } : {}),
        },
    });
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: inputBuffer } },
            { binding: 1, resource: { buffer: outputBuffer } },
            ...(atmosphereBuffer ? [{ binding: 2, resource: { buffer: atmosphereBuffer } }] : []),
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, byteLength);
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readBuffer.getMappedRange()).slice();
    readBuffer.unmap();

    for (const buffer of [inputBuffer, outputBuffer, readBuffer, atmosphereBuffer]) buffer?.destroy();

    return Array.from({ length: count }, (_, i) => [
        values[i * 4] as number,
        values[i * 4 + 1] as number,
        values[i * 4 + 2] as number,
        values[i * 4 + 3] as number,
    ]);
}
