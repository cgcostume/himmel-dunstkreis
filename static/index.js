// A separate package with no relationship to this one: it computes where the Sun is, this one renders what
// the air does to its light. The vector handed over below is the entire interface between them.
import { fromJulianDay, julianDay, sun } from "@himmel/sternzeit";
import {
    createSkyPassApprox,
    DEFAULT_ATMOSPHERE_MODEL,
    OSGHIMMEL_ATMOSPHERE_MODEL,
    precomputeAtmosphereApprox,
    readTexture,
} from "../src/approx.js";

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// --- small matrix helpers, column major to match WGSL's mat4x4f -------------------------------------------

function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    // WebGPU clip space has z in [0, 1], unlike OpenGL's [-1, 1].
    return new Float32Array([
        f / aspect,
        0,
        0,
        0,
        0,
        f,
        0,
        0,
        0,
        0,
        far / (near - far),
        -1,
        0,
        0,
        (near * far) / (near - far),
        0,
    ]);
}

/** View matrix for a camera at the origin looking along `forward`, with world up +z. Rotation only. */
function viewRotation(forward) {
    const [fx, fy, fz] = forward;
    // right = forward x up, then up = right x forward, which re-orthogonalizes without a separate step.
    let rx = fy * 1 - fz * 0;
    let ry = fz * 0 - fx * 1;
    let rz = fx * 0 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;

    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    return new Float32Array([rx, ux, -fx, 0, ry, uy, -fy, 0, rz, uz, -fz, 0, 0, 0, 0, 1]);
}

function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; ++c) {
        for (let r = 0; r < 4; ++r) {
            out[c * 4 + r] =
                a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

function invert(m) {
    const inv = new Float32Array(16);
    const a = m;

    inv[0] =
        a[5] * a[10] * a[15] -
        a[5] * a[11] * a[14] -
        a[9] * a[6] * a[15] +
        a[9] * a[7] * a[14] +
        a[13] * a[6] * a[11] -
        a[13] * a[7] * a[10];
    inv[4] =
        -a[4] * a[10] * a[15] +
        a[4] * a[11] * a[14] +
        a[8] * a[6] * a[15] -
        a[8] * a[7] * a[14] -
        a[12] * a[6] * a[11] +
        a[12] * a[7] * a[10];
    inv[8] =
        a[4] * a[9] * a[15] -
        a[4] * a[11] * a[13] -
        a[8] * a[5] * a[15] +
        a[8] * a[7] * a[13] +
        a[12] * a[5] * a[11] -
        a[12] * a[7] * a[9];
    inv[12] =
        -a[4] * a[9] * a[14] +
        a[4] * a[10] * a[13] +
        a[8] * a[5] * a[14] -
        a[8] * a[6] * a[13] -
        a[12] * a[5] * a[10] +
        a[12] * a[6] * a[9];
    inv[1] =
        -a[1] * a[10] * a[15] +
        a[1] * a[11] * a[14] +
        a[9] * a[2] * a[15] -
        a[9] * a[3] * a[14] -
        a[13] * a[2] * a[11] +
        a[13] * a[3] * a[10];
    inv[5] =
        a[0] * a[10] * a[15] -
        a[0] * a[11] * a[14] -
        a[8] * a[2] * a[15] +
        a[8] * a[3] * a[14] +
        a[12] * a[2] * a[11] -
        a[12] * a[3] * a[10];
    inv[9] =
        -a[0] * a[9] * a[15] +
        a[0] * a[11] * a[13] +
        a[8] * a[1] * a[15] -
        a[8] * a[3] * a[13] -
        a[12] * a[1] * a[11] +
        a[12] * a[3] * a[9];
    inv[13] =
        a[0] * a[9] * a[14] -
        a[0] * a[10] * a[13] -
        a[8] * a[1] * a[14] +
        a[8] * a[2] * a[13] +
        a[12] * a[1] * a[10] -
        a[12] * a[2] * a[9];
    inv[2] =
        a[1] * a[6] * a[15] -
        a[1] * a[7] * a[14] -
        a[5] * a[2] * a[15] +
        a[5] * a[3] * a[14] +
        a[13] * a[2] * a[7] -
        a[13] * a[3] * a[6];
    inv[6] =
        -a[0] * a[6] * a[15] +
        a[0] * a[7] * a[14] +
        a[4] * a[2] * a[15] -
        a[4] * a[3] * a[14] -
        a[12] * a[2] * a[7] +
        a[12] * a[3] * a[6];
    inv[10] =
        a[0] * a[5] * a[15] -
        a[0] * a[7] * a[13] -
        a[4] * a[1] * a[15] +
        a[4] * a[3] * a[13] +
        a[12] * a[1] * a[7] -
        a[12] * a[3] * a[5];
    inv[14] =
        -a[0] * a[5] * a[14] +
        a[0] * a[6] * a[13] +
        a[4] * a[1] * a[14] -
        a[4] * a[2] * a[13] -
        a[12] * a[1] * a[6] +
        a[12] * a[2] * a[5];
    inv[3] =
        -a[1] * a[6] * a[11] +
        a[1] * a[7] * a[10] +
        a[5] * a[2] * a[11] -
        a[5] * a[3] * a[10] -
        a[9] * a[2] * a[7] +
        a[9] * a[3] * a[6];
    inv[7] =
        a[0] * a[6] * a[11] -
        a[0] * a[7] * a[10] -
        a[4] * a[2] * a[11] +
        a[4] * a[3] * a[10] +
        a[8] * a[2] * a[7] -
        a[8] * a[3] * a[6];
    inv[11] =
        -a[0] * a[5] * a[11] +
        a[0] * a[7] * a[9] +
        a[4] * a[1] * a[11] -
        a[4] * a[3] * a[9] -
        a[8] * a[1] * a[7] +
        a[8] * a[3] * a[5];
    inv[15] =
        a[0] * a[5] * a[10] -
        a[0] * a[6] * a[9] -
        a[4] * a[1] * a[10] +
        a[4] * a[2] * a[9] +
        a[8] * a[1] * a[6] -
        a[8] * a[2] * a[5];

    const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    if (det === 0) return inv;
    for (let i = 0; i < 16; ++i) inv[i] /= det;
    return inv;
}

// --- state ------------------------------------------------------------------------------------------------

const state = {
    julianDay: julianDay(nowAsAstronomicalTime()),
    latitude: 52.39206070410163,
    longitude: 13.0925764790797,
    // Camera, in the same frame as the Sun: x north, y east, z up.
    yaw: 0,
    pitch: 12 * DEG,
};

function nowAsAstronomicalTime() {
    const d = new Date();
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        utcOffsetSeconds: 0,
    };
}

/**
 * The Sun as a direction vector in the observer's local frame, z up. Horizontal coordinates come out of
 * sternzeit as an altitude above the horizon and a compass azimuth measured from north through east.
 */
function sunDirection() {
    const time = fromJulianDay(state.julianDay);
    const { altitude, azimuth } = sun.horizontalPosition(time, state.latitude, state.longitude);

    const a = altitude * DEG;
    const z = azimuth * DEG;
    return { vector: [Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)], altitude, azimuth };
}

function currentModel() {
    const mie = Number($("mieAmount").value) * 1e-3;
    const ozoneScale = Number($("ozone").value);
    const base = DEFAULT_ATMOSPHERE_MODEL;

    return {
        ...base,
        rayleigh: { ...base.rayleigh, scaleHeightKm: Number($("rayleigh").value) },
        mie: {
            scaleHeightKm: Number($("mieHeight").value),
            betaScattering: [mie, mie, mie],
            // The usual single-scattering albedo of 0.9 for atmospheric aerosols: a tenth is absorbed.
            betaExtinction: [mie / 0.9, mie / 0.9, mie / 0.9],
            g: Number($("mieG").value),
        },
        ozone: {
            ...base.ozone,
            betaAbsorption: base.ozone.betaAbsorption.map((c) => c * ozoneScale),
        },
    };
}

// --- LUT previews -----------------------------------------------------------------------------------------

/**
 * Draws a float texture into a canvas and points a download link at it. Rows are flipped so that altitude,
 * which is the vertical axis of every one of these tables, increases upward as you would expect it to.
 */
function drawLut(canvas, pixels, tonemap) {
    const { width, height, data } = pixels;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const src = ((height - 1 - y) * width + x) * 4;
            const dst = (y * width + x) * 4;
            for (let c = 0; c < 3; ++c) {
                let v = data[src + c];
                if (!Number.isFinite(v) || v < 0) v = 0;
                if (tonemap) v = v / (1 + v);
                image.data[dst + c] = Math.round(255 * Math.min(1, v) ** (1 / 2.2));
            }
            image.data[dst + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);
}

/** Saves a canvas as a PNG. The object URL is created on demand and released again straight away. */
function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    });
}

// --- main -------------------------------------------------------------------------------------------------

const status = $("status");

function showSkyError(html) {
    $("sky").innerHTML = `<div class="sky-error"><p>${html}</p></div>`;
}

/**
 * Sets up WebGPU, or explains why it could not. Returns null rather than throwing, so that the rest of the
 * page still works: the controls, the readouts and the Sun position are worth having even where the sky
 * cannot be drawn, and a browser without WebGPU should not get a page that does nothing at all.
 */
async function setupGpu() {
    if (!navigator.gpu) {
        showSkyError(
            "This page needs WebGPU, which this browser does not expose.<br />Try a current Chrome, Edge or " +
                "Safari. Firefox has it on Windows, and behind <code>dom.webgpu.enabled</code> elsewhere. " +
                'See <a href="https://caniuse.com/webgpu" target="_blank" rel="noopener">caniuse.com/webgpu</a>.',
        );
        return null;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        // By far the most common cause on Linux, where Chrome still ships WebGPU behind a flag: the API
        // object exists, so feature detection passes, but there is no adapter behind it.
        showSkyError(
            "WebGPU is present but no adapter was found, so there is no GPU to render on.<br />On Linux, " +
                "Chrome still needs <code>chrome://flags/#enable-unsafe-webgpu</code> set to Enabled " +
                "(and sometimes <code>#enable-vulkan</code>), then a restart. " +
                '<a href="https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips" ' +
                'target="_blank" rel="noopener">Chrome\u2019s troubleshooting guide</a> has the rest.',
        );
        return null;
    }

    const canvas = $("canvas");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    return { canvas, device, context, format };
}

async function main() {
    const gpu = await setupGpu();
    const { canvas, device, context, format } = gpu ?? {};

    let luts = null;
    let pass = null;
    let precomputeMs = 0;

    async function rebuild() {
        if (!gpu) return;
        const started = performance.now();

        luts?.destroy();
        pass?.destroy();

        luts = await precomputeAtmosphereApprox(device, { model: currentModel() });
        pass = createSkyPassApprox(device, {
            luts,
            format,
            refraction: $("refraction").checked,
        });
        precomputeMs = performance.now() - started;

        drawLut($("lutTransmittance"), await readTexture(device, luts.transmittance), false);
        drawLut($("lutMultiScattering"), await readTexture(device, luts.multiScattering), true);

        render();
    }

    function render() {
        if (!gpu || !pass) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const sunNow = sunDirection();

        const forward = [
            Math.cos(state.pitch) * Math.cos(state.yaw),
            Math.cos(state.pitch) * Math.sin(state.yaw),
            Math.sin(state.pitch),
        ];
        const projection = perspective(60 * DEG, width / height, 0.1, 100);
        const inverseViewProjection = invert(multiply(projection, viewRotation(forward)));

        pass.update({
            sunDirection: sunNow.vector,
            observerHeightM: Number($("height").value),
            inverseViewProjection,
            exposure: Number($("exposure").value),
            refraction: $("refraction").checked ? {} : false,
            lHeureBleue: { color: [0.08, 0.3, 0.7], intensity: Number($("blueHour").value) },
        });

        const encoder = device.createCommandEncoder();
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.encode(renderPass);
        renderPass.end();
        device.queue.submit([encoder.finish()]);

        $("sunPosition").textContent =
            `sun: ${sunNow.altitude.toFixed(2)}° altitude, ${sunNow.azimuth.toFixed(2)}° azimuth`;
        status.textContent =
            `precompute ${precomputeMs.toFixed(1)} ms · ${luts.config.transmittance.width}×` +
            `${luts.config.transmittance.height} transmittance · ${luts.config.multiScattering.width}×` +
            `${luts.config.multiScattering.height} multiple scattering · ${luts.config.skyView.width}×` +
            `${luts.config.skyView.height} sky view`;

        scheduleSkyViewPreview();
    }

    // The sky-view preview needs a GPU-to-CPU readback and a PNG encode, which is far more expensive than
    // the frame that produced it. Doing that per frame is what made dragging the Julian Day crawl, so it
    // waits until the interaction stops instead. The sky itself is never held up by it.
    let previewTimer = null;
    function scheduleSkyViewPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => {
            drawLut($("lutSkyView"), await readTexture(device, pass.skyViewTexture), true);
        }, 250);
    }

    // --- input wiring ---

    let frame = null;
    function requestRender() {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            render();
        });
    }

    let rebuildTimer = null;
    function requestRebuild() {
        clearTimeout(rebuildTimer);
        // Debounced, because dragging a slider would otherwise queue a precompute per pointer event. The
        // precompute is milliseconds, but the readbacks that follow it are not.
        rebuildTimer = setTimeout(rebuild, 60);
    }

    function syncTime() {
        $("jd").value = state.julianDay.toFixed(8);
        const t = fromJulianDay(state.julianDay);
        $("calendar").textContent =
            `${t.year}-${String(t.month).padStart(2, "0")}-${String(Math.floor(t.day)).padStart(2, "0")} ` +
            `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}:` +
            `${String(Math.floor(t.second)).padStart(2, "0")} UTC`;
    }

    function dms(value, positive, negative) {
        const sign = value < 0 ? negative : positive;
        const abs = Math.abs(value);
        const d = Math.floor(abs);
        const m = Math.floor((abs - d) * 60);
        const s = ((abs - d) * 60 - m) * 60;
        return `${d}° ${m}′ ${s.toFixed(2)}″ ${sign}`;
    }

    function syncPlace() {
        $("latitudeDms").textContent = dms(state.latitude, "N", "S");
        $("longitudeDms").textContent = dms(state.longitude, "E", "W");
    }

    for (const [input, step, key] of [
        ["jd", "jdStep", "julianDay"],
        ["latitude", "latitudeStep", "latitude"],
        ["longitude", "longitudeStep", "longitude"],
    ]) {
        $(input).addEventListener("input", () => {
            state[key] = Number($(input).value);
            syncPlace();
            if (key === "julianDay") syncTime();
            requestRender();
        });
        $(step).addEventListener("change", () => {
            $(input).step = $(step).value;
        });
        $(input).step = $(step).value;
    }

    $("now").addEventListener("click", () => {
        state.julianDay = julianDay(nowAsAstronomicalTime());
        syncTime();
        requestRender();
    });

    let liveTimer = null;
    $("live").addEventListener("change", () => {
        clearInterval(liveTimer);
        if (!$("live").checked) return;
        liveTimer = setInterval(() => {
            state.julianDay = julianDay(nowAsAstronomicalTime());
            syncTime();
            requestRender();
        }, 1000);
    });

    $("geolocate").addEventListener("click", () => {
        if (!navigator.geolocation) {
            $("location").textContent = "geolocation unavailable";
            return;
        }
        $("location").textContent = "locating…";
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                state.latitude = coords.latitude;
                state.longitude = coords.longitude;
                $("latitude").value = String(coords.latitude);
                $("longitude").value = String(coords.longitude);
                $("location").textContent = "";
                syncPlace();
                requestRender();
            },
            (error) => {
                $("location").textContent = error.message;
            },
        );
    });

    const FORMATS = {
        height: (v) => `${v} m`,
        exposure: (v) => Number(v).toFixed(1),
        blueHour: (v) => Number(v).toFixed(2),
        rayleigh: (v) => `${Number(v).toFixed(1)} km`,
        mieHeight: (v) => `${Number(v).toFixed(1)} km`,
        mieAmount: (v) => `${Number(v).toFixed(1)}e-3`,
        mieG: (v) => Number(v).toFixed(2),
        ozone: (v) => `${Number(v).toFixed(2)}×`,
    };

    // Sliders that only change how the sky is shaded re-render; the ones that change the atmosphere itself
    // invalidate the precomputed tables and have to rebuild them.
    for (const id of ["height", "exposure", "blueHour"]) {
        const sync = () => {
            $(`${id}Out`).textContent = FORMATS[id]($(id).value);
        };
        $(id).addEventListener("input", () => {
            sync();
            requestRender();
        });
        sync();
    }

    for (const id of ["rayleigh", "mieHeight", "mieAmount", "mieG", "ozone"]) {
        const sync = () => {
            $(`${id}Out`).textContent = FORMATS[id]($(id).value);
        };
        $(id).addEventListener("input", () => {
            sync();
            requestRebuild();
        });
        sync();
    }

    $("refraction").addEventListener("change", requestRebuild);

    function applyPreset(model) {
        $("rayleigh").value = String(model.rayleigh.scaleHeightKm);
        $("mieHeight").value = String(model.mie.scaleHeightKm);
        $("mieAmount").value = String(model.mie.betaScattering[0] * 1e3);
        $("mieG").value = String(model.mie.g);
        $("ozone").value = model.ozone.betaAbsorption[1] > 0 ? "1" : "0";

        for (const id of ["rayleigh", "mieHeight", "mieAmount", "mieG", "ozone"]) {
            $(`${id}Out`).textContent = FORMATS[id]($(id).value);
        }
        requestRebuild();
    }

    for (const [button, canvasId] of [
        ["dlTransmittance", "lutTransmittance"],
        ["dlMultiScattering", "lutMultiScattering"],
        ["dlSkyView", "lutSkyView"],
    ]) {
        $(button).addEventListener("click", () => downloadCanvas($(canvasId), $(button).dataset.filename));
    }

    $("presetDefault").addEventListener("click", () => applyPreset(DEFAULT_ATMOSPHERE_MODEL));
    $("presetOsgHimmel").addEventListener("click", () => applyPreset(OSGHIMMEL_ATMOSPHERE_MODEL));

    // Drag to look around.
    let dragging = null;
    canvas?.addEventListener("pointerdown", (event) => {
        dragging = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas?.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        state.yaw -= (event.clientX - dragging.x) * 0.004;
        // Clamped short of the zenith, where the camera's up vector would be parallel to the view direction.
        state.pitch = Math.max(-80 * DEG, Math.min(85 * DEG, state.pitch + (event.clientY - dragging.y) * 0.004));
        dragging = { x: event.clientX, y: event.clientY };
        requestRender();
    });
    for (const event of ["pointerup", "pointercancel"]) {
        canvas?.addEventListener(event, () => {
            dragging = null;
        });
    }

    window.addEventListener("resize", requestRender);

    syncTime();
    syncPlace();
    await rebuild();
}

main().catch((error) => {
    status.textContent = `failed: ${error.message}`;
    console.error(error);
});
