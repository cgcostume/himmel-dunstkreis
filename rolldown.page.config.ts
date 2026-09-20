import { defineConfig } from "rolldown";
import { wgsl } from "./rolldown.config.js";

/**
 * Bundles the dev page into a single self-contained module: this package straight from `src/` (so editing a
 * shader needs no separate library build) plus `@himmel/sternzeit`, which lives outside this repo as a
 * linked path dependency and could not be served from here otherwise.
 *
 * The result is a page of three files with no `node_modules`, which is also what a static host needs.
 */
export default defineConfig({
    input: "static/index.js",
    plugins: [wgsl()],
    output: { file: "static/bundle.js", format: "es" },
});
