# Glossary

Atmospheric scattering and rendering terms used across this library, mostly following Bruneton & Neyret,
"Precomputed Atmospheric Scattering" (2008) and Hillaire, "A Scalable and Production Ready Sky and Atmosphere
Rendering Technique" (2020). Written for readers comfortable with code and with GPU work, but not necessarily
with atmospheric optics.

## Scattering

- **Scattering**: Light hitting a particle and leaving in a different direction, rather than being absorbed.
  Every color the sky has comes from sunlight scattered out of beams that were never aimed at the viewer.
- **Rayleigh scattering**: Scattering by particles much smaller than the wavelength, i.e. air molecules. Its
  strength goes as `1/λ⁴`, so blue light scatters roughly 5.5x more than red. This is why the sky is blue and
  why the low sun is red: at a grazing angle the path is long enough that most blue has been scattered out of
  the direct beam before it reaches you.
- **Mie scattering**: Scattering by particles comparable to or larger than the wavelength, i.e. aerosols, dust,
  water droplets, haze. Nearly wavelength-independent (hence white/gray haze) and strongly forward-biased,
  which produces the bright glow around the sun.
- **Ozone absorption**: Unlike the two above, ozone *absorbs* rather than scatters, mostly in the green-yellow
  band, and it lives in a layer centered around 25 km rather than falling off exponentially from the ground.
  Omitting it makes twilight look too gray; including it produces the deep blue of the late blue hour.
- **Extinction**: Everything that removes light from a beam, i.e. scattering away from the beam *plus*
  absorption. For Rayleigh, extinction equals scattering (air molecules do not absorb visible light); for Mie
  they differ, which is why the model carries `betaScattering` and `betaExtinction` separately.
- **Scattering coefficient (β)**: Probability per unit length that a photon is scattered, in `1/km`, given per
  RGB channel since it is wavelength-dependent. `betaR = (5.8e-3, 1.35e-2, 3.31e-2)` at sea level.
- **Optical depth (τ)**: The integral of the extinction coefficient along a path, i.e. a dimensionless "how
  much atmosphere is in the way" number. Not itself a fraction of light.
- **Transmittance (T)**: The fraction of light surviving a path, `T = exp(-τ)`, from Beer-Lambert's law. This
  is the quantity the transmittance LUT stores.
- **Inscatter (S)**: Light that was travelling some other direction, got scattered *into* the view ray, and so
  adds to what you see. The sky's brightness is inscatter; without it the daytime sky would be black.
- **Phase function**: How scattering from a single particle is distributed over outgoing directions, as a
  function of `nu`, the cosine of the angle between the view ray and the light. Rayleigh's is the gentle
  `3/(16π)·(1+nu²)`; Mie's uses Henyey-Greenstein with an asymmetry parameter `g`.
- **Henyey-Greenstein `g`**: The forward-scattering bias of the Mie phase function, in `[-1, +1]`. 0 is
  isotropic, positive is forward-scattering (the physical case for aerosols), and larger values tighten the
  glow around the sun.
- **Single vs. multiple scattering**: Single scattering counts photons that bounced exactly once before
  reaching the eye. Multiple scattering counts those that bounced repeatedly. Skipping multiple scattering is
  cheap and looks acceptable at midday, but it is what makes twilight and a below-horizon sun look right, so
  both variants here include it.
- **Scale height**: The altitude over which a density profile falls by a factor of `e`. ~8 km for Rayleigh
  (air itself), ~1.2 km for Mie (aerosols hug the ground). The original osgHimmel used 6 km for Mie, following
  Bruneton; 1.2 km is the modern value and the default here.
- **Airmass**: The path length through the atmosphere relative to straight up. ~1 at the zenith, ~38 at the
  horizon, which is the whole reason sunsets look different from noon.

## Parameterization

- **`Rg` / `Rt`**: The radius of the ground (Earth's mean radius, 6371 km) and the radius of the top of the
  atmosphere (`Rg` + 85 km). The atmosphere is the shell between them, and the observer must be inside it.
- **`r`**: Distance from the planet's center to the sample point, so `r - Rg` is altitude. The first axis of
  every LUT.
- **`mu` (μ)**: Cosine of the angle between the view ray and the local up vector (the zenith). `mu = 1` is
  straight up, `mu = 0` is the horizon, negative is downward.
- **`muS` (μₛ)**: Cosine of the angle between the *sun* direction and local up, i.e. the sun's elevation.
- **`nu` (ν)**: Cosine of the angle between the view ray and the sun direction, the argument the phase
  functions need.
- **LUT (lookup table)**: A texture precomputed once, then sampled per pixel in place of an expensive
  integral. The whole point of both variants.
- **Transmittance LUT**: 2D, indexed by `(r, mu)`, storing `exp(-τ)` from the sample point to the top of the
  atmosphere. Shared by both variants, though the two papers map `(r, mu)` to uv differently.
- **Irradiance LUT (E)**: 2D, indexed by `(r, muS)`, storing the skylight arriving at a point from the whole
  hemisphere. Bruneton only; used for the ground-reflectance bounce.
- **Inscatter LUT (S)**: Bruneton's 4D table over `(r, mu, muS, nu)`, packed into a 3D texture because
  hardware has no 4D sampler. Unpacking it is `texture4D` in the original shader, and it is the most
  fiddly part of that variant.
- **Multi-scattering LUT**: Hillaire's replacement for the above, 2D over `(r, muS)`. Assumes multiply
  scattered light is isotropic, which lets an infinite number of orders be summed in closed form into a tiny
  32x32 texture.
- **Sky-view LUT**: Hillaire's per-frame 2D table over view direction, with a non-linear latitude mapping that
  spends most of its resolution near the horizon where the gradient is steep.
- **Scattering order**: In Bruneton's algorithm 4.1, each iteration adds photons that bounced one more time.
  osgHimmel ran four; each is a full pass over the 4D table.
- **Aerial perspective**: Atmosphere *between the camera and nearby geometry*, i.e. distance haze, as opposed
  to the sky itself. Out of scope here; this library renders the sky dome.

## Rendering

- **Atmospheric refraction**: Air bends light, lifting everything's apparent altitude. ~34' at an apparent
  altitude of 0, slightly more than the sun's own ~32' diameter, so the sun you watch touching the horizon has
  geometrically already set. Falls to 0 at the zenith. See the README for how this library applies it per ray.
- **Bennett's formula (AA.15.3)**: The standard empirical fit taking *apparent* altitude to the refraction
  that produced it, which is what a renderer warping a camera ray needs, since camera rays are apparent
  directions. Its companion AA.15.4 (Saemundsson) runs the other way, true to apparent, and is what
  `@himmel/sternzeit`'s `earth.atmosphericRefraction` implements. They differ by ~5' at the horizon and are
  not interchangeable. Both depend on air's *refractive index*, which is unrelated to the scattering
  coefficients, so neither can be derived from the model parameters; refraction is carried separately.
- **L'heure bleue (the blue hour)**: The stretch of twilight when the sun is well below the horizon and the
  sky goes deep, saturated blue. osgHimmel added it as an explicit artistic tint on top of the model, and
  that tint is ported here as `lheurebleue`.
- **Exposure / tone mapping**: The model outputs physical radiance over a range no display can show, so a
  final curve maps it to `[0, 1]`. `hdr()` in the original shader.
- **Storage texture**: A WebGPU texture a compute shader can write to directly. What the precompute passes
  target, replacing the original's render-to-FBO ping-pong.
