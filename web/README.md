# Afterglow — Voxel Tokyo at dusk

An interactive voxel diorama based on *Tokyo Sunset: Pagoda and Neon Skyline*. It includes a five-storey pagoda on a stone-walled hill, a torii and lantern approach, sakura, a downhill old town, an elevated railway with moving trains, a neon district, and a glowing Tokyo Tower against a violet sunset.

Everything is generated procedurally in the browser in a few seconds. There are no model files and no build step.

## Run

```bash
cd web
python3 -m http.server 5180
```

Then open <http://localhost:5180>. Any static file server works.

URL options: `?view=hero|shrine|pagoda|street|neon|rail|tower|aerial`, `?t=0..1` (time of day), `?cine` (start the film), `?noui`.

## Controls

| Input | Action |
| --- | --- |
| Drag / right-drag / scroll | orbit / pan / zoom |
| Double-click | focus the orbit on that spot |
| W A S D, Q E (Shift = fast) | fly |
| 1–8 | viewpoints |
| C | cinematic mode (Space pause, ← → shots, Esc exit) |
| T | cycle time of day |
| M | music: 夕焼けラジオ · Afterglow FM (volume in the now-playing pill) |
| P | screenshot · F fullscreen · H hide UI · \` stats |

## How it works

- **`src/voxel.js`**: a sparse chunked voxel store with 64³ chunks and a mesher. The mesher culls hidden faces, bakes per-vertex ambient occlusion with anisotropy-correct quad splits, and bakes point-light spill from lanterns, lamps and signs into a vertex attribute. Vertex data is packed into 16 bytes per vertex. Emissive voxels are tagged with a group, so neon flicker, the tower lights, window lights and aviation blinkers can animate without remeshing.
- **`src/sky.js`**: the analytic sunset sky. The same function drives the sky dome, the aerial-perspective fog, and the cloud tint, so distant blocks melt into the sky. It has four time-of-day keyframes: Golden hour, Sunset (the painting), Blue hour, and Night.
- **Worlds at several scales**: the old town, district and tower use 1-unit voxels. The skyline uses 3-unit voxels out to about 800 m and 6-unit voxels to the horizon. Clouds use 9-unit voxels.
- **`src/build/*`**: the procedural builders for terrain, pagoda, shrine, machiya houses, trees, neon district, skyline, Tokyo Tower, railway, train, props and clouds. Neon signs are rasterised from real Japanese text.
- **`src/fx.js`**: GPU-animated sakura petals, plus the post stack: MSAA HDR, bloom, an optional tilt-shift "diorama" pass, colour grade (vignette, chromatic fringe, grain), and ACES output.
- **`src/cinematic.js`**: an eight-shot director with eased camera paths, dip-to-black cuts, a 2.39:1 letterbox, and captions.
- **`src/audio.js`**: *Afterglow FM*, a generative lo-fi / city-pop soundtrack composed live in WebAudio with no audio files. It combines an FM electric piano with tape wow, a Karplus-Strong koto playing a pentatonic melody (with occasional *oshide* pitch bends), a sine bass, saw pads, swung synthesized drums with side-chain pumping, vinyl crackle, wind, and fūrin chimes.
  - It is arranged in sections: intro → groove → melody → busier groove → breakdown.
  - Each time of day has its own mood, which takes over at the next bar line: Golden hour 84 BPM, Sunset 78, Blue hour 72, Night 66 (half-time).
  - Neon signs pulse with the kick drum, cinematic cuts trigger bell accents, entering cinematic mode starts the music, and passing trains rumble and clack, panned to their position on screen.

Rendering adapts its pixel ratio to keep the frame rate up.
