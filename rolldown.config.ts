import { defineConfig, type Plugin } from "rolldown";
import { dts } from "rolldown-plugin-dts";

/**
 * Inlines `.wgsl` files as strings at build time, so shaders stay real `.wgsl` files (syntax highlighting,
 * no escaping, diffable) while `dist` reads nothing from disk and works in a browser. `src/wgsl.d.ts` gives
 * tsc the matching declaration.
 */
const wgsl = (): Plugin => ({
    name: "wgsl",
    transform: {
        filter: { id: /\.wgsl$/ },
        handler(code) {
            return { code: `export default ${JSON.stringify(code)};`, moduleType: "js" };
        },
    },
});

export default defineConfig({
    input: {
        index: "src/index.ts",
        approx: "src/approx.ts",
    },
    plugins: [wgsl(), dts()],
    output: {
        dir: "dist",
        format: "es",
    },
});
