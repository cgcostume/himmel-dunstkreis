# @himmel/dunstkreis

WebGPU compute-based atmospheric scattering (Bruneton et al. precomputed
model) for sky rendering. A TypeScript port of the atmosphere rendering
of [osgHimmel](https://github.com/cgcostume/osghimmel), reimplemented as
WebGPU compute shaders writing directly to storage textures rather than
the original's OpenGL FBO-ping-pong-through-fragment-shaders approach.

Takes a sun/moon direction vector and time as plain inputs — no hard
dependency on [`@himmel/sternzeit`](https://github.com/cgcostume/himmel-sternzeit)
or any other `@himmel/*` package, so it drops into any existing WebGPU
renderer.

## Status

Early port in progress. Currently implemented: the physical model and
LUT-resolution configuration surface (`src/model.ts`), matching
osgHimmel's `t_modelCfg`/`t_preTexCfg` defaults. The compute pipeline
(transmittance/irradiance/inscatter LUT passes) follows next.

## Development

```sh
pnpm install
pnpm build       # rolldown -> dist/*.js + dist/*.d.ts
pnpm typecheck   # tsc --noEmit
pnpm test        # playwright test
```
