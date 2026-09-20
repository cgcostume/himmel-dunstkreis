/**
 * Shaders are authored as real `.wgsl` files and imported as strings. Rolldown inlines them at build time
 * (see the `wgsl` plugin in `rolldown.config.ts`), so nothing reads from disk at runtime and `dist` stays
 * browser-safe.
 */
declare module "*.wgsl" {
    const source: string;
    export default source;
}
