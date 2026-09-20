# @himmel/dunstkreis

WebGPU atmospheric scattering for sky rendering, a TypeScript port of the
atmosphere rendering of [osgHimmel](https://github.com/cgcostume/osghimmel),
reimplemented as WebGPU compute shaders writing to storage textures rather
than the original's OpenGL FBO-ping-pong-through-fragment-shaders approach.

Not a renderer: it is a render component. It never creates a device, a
canvas, a context, or a render pass. You hand it a `GPUDevice` and record
into your own pass, or take the WGSL and the bind group layouts and inline
them yourself.

Takes a sun/moon direction vector and time as plain inputs, no hard
dependency on [`@himmel/sternzeit`](https://github.com/cgcostume/himmel-sternzeit)
or any other `@himmel/*` package, so it drops into any existing WebGPU
renderer.

New to terms like inscatter, optical depth, or scale height? See [GLOSSARY.md](./GLOSSARY.md).

## Two variants

Both are provided, in the same spirit as `@himmel/sternzeit`'s precise/approximate pairs.

| export | technique | LUTs |
|---|---|---|
| `@himmel/dunstkreis` | Bruneton & Neyret 2008, the faithful osgHimmel port | transmittance 256x64, irradiance 64x16, 4D inscatter 32x128x32x8, N scattering orders |
| `@himmel/dunstkreis/approx` | Hillaire 2020 | transmittance 256x64, multiscattering 32x32, sky-view 192x108 per frame |

`approx` is a slight misnomer, kept for consistency with `sternzeit`'s naming: Hillaire is not a cheaper
approximation *of* Bruneton but a different decomposition, and its multiple-scattering term is infinite-order
(under an isotropic assumption) where Bruneton's is a fixed number of orders. It is much cheaper to precompute
and lower resolution, so "fast vs. precise" holds overall, but it will not always look worse.

## Observer altitude and refraction

The observer must be *inside* the atmosphere; views from space are not supported. Within that, altitude is
unrestricted (0 to the top of the atmosphere), since the LUTs are parameterized over the full radius range
anyway and it costs nothing.

Atmospheric refraction is applied per view ray, not as the original's single per-frame direction correction
(osgHimmel computed one refracted sun/moon vector CPU-side and passed it in as `sunr`/`moonr`; stars were never
refracted at all). Warping the ray instead produces three things from one function: bodies staying visible
while geometrically below the horizon, the whole sky compressing slightly near the horizon, and the vertical
flattening of the sun/moon disc near the horizon, which falls out of the steep `dR/da` there rather than
needing the disc to be special-cased. Observer altitude enters as the air pressure ratio, so refraction
naturally falls off with height and vanishes at the top of the atmosphere.

The implementation is exported from the shared WGSL layer so that the moon, star, and cloud modules can warp
their rays with the same function. Because a camera ray is an *apparent* direction, it uses Bennett's fit
(Meeus AA.15.3, apparent to true), the WGSL twin of `@himmel/sternzeit`'s
`earth.atmosphericRefractionFromApparent`. Its companion `earth.atmosphericRefraction` is AA.15.4, running
true to apparent, for consumers correcting a computed body position instead. The two differ by ~5' at the
horizon and are not interchangeable; a test pins them to each other as inverses so they cannot drift.

Apply one or the other, never both. If you already feed in a refracted (apparent) sun or moon direction, the
way osgHimmel's `sunr`/`moonr` uniforms did, turn the ray warp off, or the body is lifted twice and ends up
about a degree out of place.

## Status

Early port in progress. Implemented so far, all shared by both variants:

- `src/model.ts`: the physical model and LUT configuration, with `OSGHIMMEL_ATMOSPHERE_MODEL` reproducing
  the original's `t_modelCfg` exactly and the defaults moved to modern values (thinner aerosol layer,
  stronger forward scattering, ozone).
- `src/refraction.ts` and `src/wgsl/refraction.wgsl`: the per-ray refraction correction, as a matched
  TypeScript/WGSL pair.
- `src/wgsl/atmosphere.wgsl` and `src/uniforms.ts`: the `DkAtmosphere` uniform block and its packer.
- `src/wgsl/quality.wgsl` and `src/quality.ts`: the pipeline-overridable constants for sample counts and
  feature switches.
- `src/wgsl/common.wgsl`: ray-sphere geometry, density profiles and phase functions.
- `src/pass.ts`: the `SkyPass`/`AtmosphereLUTs` interfaces both variants implement.

The compute pipelines follow next, Hillaire first, then Bruneton.

### Composing the shaders

The shaders are authored as real `.wgsl` files under `src/wgsl/` and exported as strings, so they can be
pasted into a shader of yours instead of going through this package's passes:

```js
import { wgsl, atmosphereUniformData, pipelineConstants, DEFAULT_ATMOSPHERE_MODEL, DEFAULT_TEXTURE_CONFIG }
    from "@himmel/dunstkreis";

const module = device.createShaderModule({ code: `
${wgsl.scattering}                                        // DkAtmosphere + the functions that take it
@group(2) @binding(0) var<uniform> sky: DkAtmosphere;     // your binding, your indices

@fragment fn fs(@location(0) ray: vec3f) -> @location(0) vec4f {
    let mu = dot(normalize(ray), up);
    let horizon = dkHorizonMu(sky, r);
    ...
}` });

device.queue.writeBuffer(buffer, 0, atmosphereUniformData(DEFAULT_ATMOSPHERE_MODEL)); // 96 bytes
```

Three properties make this composable:

**No bindings are declared.** `common.wgsl`'s functions take the `DkAtmosphere` struct by value as their
first argument rather than reading a `var<uniform>`, so nothing here can collide with your group or binding
indices, and you decide where the data lives. `refraction.wgsl` goes further and takes no uniform at all, so
the moon, star and cloud modules can paste it in on its own and warp their rays with the same function the
sky uses.

**Parameters are a uniform block, not string substitution.** `atmosphereUniformData()` packs a model into the
96-byte layout `atmosphere.wgsl` declares. A test parses that struct, walks it applying WGSL's uniform layout
rules, and checks the packer writes the right value at every offset, since nothing in the toolchain would
otherwise catch the two drifting apart.

**Quality is specialized with `override`s, not uniforms.** Sample counts and feature switches live in
`quality.wgsl` as pipeline-overridable constants, set through `constants` on the pipeline descriptor via
`pipelineConstants(config)`. Integration loop bounds stay compile-time constants so the compiler can unroll
them, and a disabled feature leaves no code behind rather than branching per pixel: building with
`pipelineConstants(config, { refraction: false })` produces a pipeline with no refraction in it, which is
what a consumer already feeding refracted sun and moon directions wants.

Every identifier is prefixed `dk`/`DK_` so several `@himmel/*` fragments can share one shader module.
Rolldown inlines the `.wgsl` files at build time, so `dist` reads nothing from disk and stays browser-safe.

### A note on testing shaders

The WGSL is tested by executing it, against the TypeScript twins, via Dawn in-process (`tests/gpu.ts`), not
in a browser: Playwright's bundled Chromium exposes no `navigator.gpu` at all, in any launch mode or behind
any flag. Those tests are opt-in (`pnpm test:gpu`) because the `webgpu` package aborts or deadlocks the
process in roughly one run in three, in plain node as much as under Playwright and regardless of the
workload. It has never produced a *wrong* value, only crashes, so the pure-TypeScript tests carry the
baseline and the GPU tests are run deliberately when touching WGSL.

## References

osgHimmel itself originated as [Daniel Limberger](https://daniellimberger.de)'s (né Müller) master's thesis at
HPI: ["Photorealistisches Rendering atmosphärischer Effekte in geovirtuellen 3D-Umgebungen in
Echtzeit"](https://daniellimberger.de/resources/2012%20%E2%80%93%20Mueller%20%28now%20Limberger%29%20%E2%80%93%20Photorealistisches%20Rendering%20atmosphaerischer%20Effekte%20in%20geovirtuellen%203D-Umgebungen%20in%20Echtzeit.pdf)
(2012, German).

- E. Bruneton, F. Neyret, ["Precomputed Atmospheric Scattering"](https://inria.hal.science/inria-00288758)
  (EGSR 2008) — the precise variant, and the model osgHimmel's atmosphere is built on.
- S. Hillaire, ["A Scalable and Production Ready Sky and Atmosphere Rendering
  Technique"](https://sebh.github.io/publications/egsr2020.pdf) (EGSR 2020) — the fast variant.
- T. Nishita, T. Sirai, K. Tadamura, E. Nakamae, "Display of the Earth Taking into Account Atmospheric
  Scattering" (SIGGRAPH 1993) — atmosphere thickness constant.
- A. Bucholtz, "Rayleigh-scattering calculations for the terrestrial atmosphere" (1995) — Rayleigh
  scattering coefficients.
- G. G. Bennett, "The Calculation of the Astronomical Refraction in Marine Navigation" (1982) — atmospheric
  refraction.
- Maxime Heckel, ["On rendering the sky, sunsets and
  planets"](https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/) — a WebGL/three.js
  single-scattering raymarcher; the ozone absorption parameterization here follows it.
- Daniel Müller (now Limberger), Juri Engel, Jürgen Döllner,
  ["Single-Pass Rendering of Day and Night Sky Phenomena"](https://diglib.eg.org/items/0b9332fd-d155-452a-b9e0-1c605d557730)
  (VMV 2012).

## Development

```sh
pnpm install
pnpm build       # rolldown -> dist/*.js + dist/*.d.ts
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check .
pnpm format      # biome format --write .
pnpm test        # playwright test
pnpm test:gpu    # the same, plus the WGSL tests, which execute real shaders via Dawn
pnpm start       # sirv: serves the dev preview at localhost:4173/static/index.html (needs pnpm build first)
pnpm clean       # rm -rf dist
```

The dev preview additionally needs `@himmel/sternzeit` built (`pnpm build` in that repo), since it is linked
in as a local path dependency rather than from npm. See the note in `.github/workflows/ci.yml`.

`pnpm start` serves the repo root, not just `static/`, because the page loads `../dist/*.js` and
`../node_modules/@himmel/sternzeit/dist/index.js` as plain relative paths.

The `webgpu` package needs its install script to run, which is approved in `pnpm-workspace.yaml`. pnpm only
reads that setting from there, so `pnpm install --ignore-workspace` needs
`--config.strict-dep-builds=false` added, or `pnpm approve-builds` run once.
