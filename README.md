# Pixelmate

Pixelmate is a local-first workbench for turning a pixel character into a reusable semantic model, rigging that model once, authoring motion, and applying different player-character skins without changing the approved body geometry.

The application is under active development. Its strongest working path today is:

`Model → Segments + Rig → Animate → Skin → Refine → Export`

## Quick start

Requirements:

- Node.js 20.6 or newer; Node.js 22 is recommended.
- npm.

Install dependencies and launch the Vite app plus the local model bridge:

```bash
npm install
npm start
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Press `Ctrl+C` to stop the processes started by this command.

`npm start` reuses an existing service on port `8787` instead of failing when the Pixelmate bridge is already running. If port `5173` is occupied, Vite selects the next available port and prints it.

To use only browser-local features, the bridge does not need a configured model. Select **Preview mode** in the renderer menu.

## Current workflow

### 1. Build the canonical model

Start with a PNG. The Model page can:

- remove a border-connected background automatically;
- remove 0–3 pixels of related edge fringe;
- erase connected leftover color patches manually;
- restore the original source;
- pan and zoom the preview;
- snap the image to a logical pixel grid;
- quantize the result to a chosen color count.

Cleanup is non-destructive while the project remains open because `originalSource` is preserved. Running cleanup or Pixel Snapper after rigging resets derived segmentation and render data because the model geometry has changed.

### 2. Segment and rig once

The Segments + Rig workspace has four stages:

1. **Analyze** assigns opaque pixels to semantic body regions. The result can be corrected with paint, erase, pan, brush-size, and zoom controls.
2. **Layers** isolates approved regions and can request hidden-pixel completion from the selected renderer.
3. **Skeleton** displays the joint hierarchy, supports joint dragging, and uses two-bone IK for hands and feet.
4. **Poses** saves named key poses at specific frame positions and can create in-between guide frames.

Pixel ownership is exclusive: painting a pixel into one semantic part removes it from other parts. Model validation blocks skin application when the recorded opaque-pixel coverage is incomplete.

The first automatic template targets front-facing or three-quarter humanoids. Quadrupeds, vehicles, and substantially different skeletons need future templates or manual rig support.

### 3. Author reusable motion

The Animate page contains starter motions and supports custom motion clips with a frame count and frame duration.

- **Preview mode** is a workflow test mode. It does not generate novel artwork.
- **Local model** sends cycle rendering to ComfyUI through the bridge.
- **Cloud model** sends generation to the OpenAI Images API through the bridge.
- Rig-authored key poses can produce deterministic guide frames when provider-driven in-between rendering is unavailable.

Generated motion proceeds to the Skin step before Refine so appearance remains separate from motion.

### 4. Create and apply player skins

The Skin Library accepts up to eight PNG, JPEG, or WebP references per new player skin. Palette and recipe extraction run locally in the browser.

For each skin you can edit:

- palette colors;
- outline width;
- shading-band count;
- light direction;
- pixel-cluster scale;
- facial rules and must-preserve notes;
- the material slot assigned to every semantic body part;
- player-specific descriptions for rigged attachment slots.

The current locked renderer recolors each semantic part using its material palette while preserving the existing alpha mask, canvas dimensions, pivot, baseline, and frame geometry. It cannot introduce extra body pixels or limbs.

Attachment slots for hair, headwear, face details, chest/back equipment, capes or tails, and weapons are persisted and exported. Their trait descriptions are currently metadata for future provider rendering; Pixelmate does not yet rasterize new attachment artwork from those descriptions.

Applying a skin stores an approved rendered variant for the current motion. Repeating this for other motions builds a multi-motion character pack for that skin.

### 5. Refine and export

Refine currently supports:

- animation playback;
- frame selection and per-frame duration;
- onion skinning;
- flagging and retrying selected frames;
- per-frame semantic-part translation, rotation, and visibility overrides.

Pixel drawing tools are intentionally not shown because persistent pencil, eraser, frame CRUD, and undo history are not implemented yet.

**Export runtime pack** downloads a ZIP containing:

- a lossless PNG atlas;
- individual PNG frames grouped by motion;
- `manifest.json` with frame coordinates, duration, loop mode, pivot, baseline, semantic attachment slots, the active skin, and player attachment metadata.

The exporter includes every approved rendered motion variant belonging to the active skin. If no saved variant exists, it exports the currently active motion as a fallback.

## Saving projects

Use **Save project** in the app header to download a `.spriteproj` archive. The version-4 archive stores source images, rendered frames, rig layers, poses, skin references, and rendered variants as separate assets alongside `project.json`.

Use **Open project** to restore that archive. Older project data is migrated into the semantic model structure when loaded.

There is no durable browser autosave yet. Refreshing or closing the tab loses unsaved session changes, so download the project before leaving the app.

Directly opening `/import`, `/rig`, `/cycles`, `/skin`, or `/workspace` in a new browser session cannot restore an unsaved project. Load a `.spriteproj` first.

## Renderer configuration

The renderer selector is always available in the studio header.

| Mode | External dependency | Current behavior |
| --- | --- | --- |
| Preview mode | None | Repeats the source for model-generation requests and supports the deterministic local workflow. |
| Local model | Pixelmate bridge + ComfyUI | Uses `server/comfy-workflow.json` or a configured workflow for cycle generation. Local rig analysis falls back to browser analysis; layer, pose, and in-between endpoints currently use conservative bridge fallbacks. |
| Cloud model | Pixelmate bridge + OpenAI API key | Supports cycle sheets, selected-frame retry, vision-assisted rig analysis and pose suggestion, hidden-layer completion, and in-between rendering. |

The renderer status reports whether the selected service is reachable or configured. A green bridge status does not guarantee that every optional external model or custom ComfyUI node is installed.

### Local ComfyUI

ComfyUI defaults to `http://127.0.0.1:8188`. Copy the example environment file and configure the checkpoint known to your ComfyUI installation:

```bash
cp .env.local.example .env.local
```

At minimum, update:

```dotenv
COMFYUI_CHECKPOINT=your-checkpoint-file.safetensors
```

The included `server/comfy-workflow.json` uses standard ComfyUI workflow tokens. For a custom API-format workflow, set `COMFYUI_WORKFLOW` to its path.

### Cloud rendering

Add a server-side API key to `.env.local`:

```dotenv
OPENAI_API_KEY=your-api-key-here
```

The browser never receives the key. It sends requests to the bridge at `http://127.0.0.1:8787`, and the bridge makes the external API request.

Do not commit `.env.local`. For a public deployment, replace this unauthenticated development bridge with an authenticated backend.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start Vite and the bridge together. |
| `npm run dev` | Start only Vite. |
| `npm run bridge` | Start only the local bridge. |
| `npm run build` | Type-check and create the production build in `dist/`. |
| `npm run preview` | Serve the existing production build locally. |

## Troubleshooting

### `ERR_CONNECTION_REFUSED` on port 8787

Start the bridge with `npm start` or `npm run bridge`. Check the bridge itself:

```bash
curl http://127.0.0.1:8787/
```

For cloud configuration:

```bash
curl http://127.0.0.1:8787/openai/health
```

For ComfyUI configuration:

```bash
curl http://127.0.0.1:8787/health
```

`/health` depends on ComfyUI being reachable. A bridge error there does not prevent Preview mode or browser-local cleanup, segmentation, skin extraction, and locked recoloring.

### ComfyUI generation fails

Confirm that:

- ComfyUI is running;
- `COMFYUI_URL` is correct;
- the configured checkpoint exists;
- the workflow is in ComfyUI API format;
- every node used by the workflow is installed.

### Cloud mode is unavailable

Confirm that `OPENAI_API_KEY` is defined in `.env.local`, restart the bridge, and check `/openai/health`. Pixelmate does not read environment changes until the bridge restarts.

## Privacy and project boundaries

- Cleanup, quantization, semantic editing, deterministic rig guides, recipe extraction, material mapping, and locked recoloring run in the browser.
- Local-model assets are sent to the local bridge and ComfyUI.
- Cloud-model assets and configured references are sent through the local bridge to the selected cloud provider.
- Project files and runtime packs are downloaded locally; Pixelmate does not include an account or hosted project store.

## Development map

- `src/main.tsx` — application state, routing, import, motion, project archives, and runtime export.
- `src/characterModel.ts` — semantic model, player skins, recipes, validation, and locked rendering.
- `src/rigView.tsx` and `src/rig.ts` — segmentation, skeleton, poses, IK, and rig composition.
- `src/providers.ts` — Preview, Local, and Cloud renderer adapters.
- `server/bridge.mjs` — local ComfyUI and OpenAI bridge.
- `server/dev.mjs` — unified development launcher.

## Verification

The documented local commands and production build were verified against the current repository using Node.js 22. External ComfyUI generation and paid cloud requests require the user’s own services and credentials and are not exercised by the repository build.
