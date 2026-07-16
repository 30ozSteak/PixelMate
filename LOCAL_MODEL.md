# Local model testing

Pixelmate supports three renderer modes from the header:

- `Preview mode`: runs without any model service and does not generate novel artwork.
- `Local model`: calls the local bridge at `http://127.0.0.1:8787`.
- `Cloud model`: calls OpenAI through the same local bridge when `OPENAI_API_KEY` is configured.

The bridge talks to ComfyUI at `http://127.0.0.1:8188` by default.

## Start Pixelmate and the bridge

Start both development services with one command:

```bash
cd /Users/nickdambrosio/cultivator/sprite-maker
npm start
```

Press `Ctrl+C` once to stop both services. To run only the bridge:

```bash
cd /Users/nickdambrosio/cultivator/sprite-maker
COMFYUI_CHECKPOINT="your-checkpoint-file.safetensors" npm run bridge
```

If ComfyUI uses another address:

```bash
COMFYUI_URL="http://127.0.0.1:8188" \
COMFYUI_CHECKPOINT="your-checkpoint-file.safetensors" \
npm run bridge
```

Choose `Local model` in the header, then generate a cycle.

The starter workflow is `server/comfy-workflow.json`. It uploads the source sprite, encodes it, applies the cycle prompt and identity notes, then returns generated PNG frames. It assumes standard ComfyUI nodes and a checkpoint available in ComfyUI’s models folder. If your installed model requires ControlNet, IP-Adapter, or a pixel-art LoRA, copy the workflow from ComfyUI’s API format and set `COMFYUI_WORKFLOW=/absolute/path/to/workflow.json`.

The bridge reports connection and generation errors inside the app; switching back to `Preview mode` remains available at any time.

## Cloud model with your own API key

You can use the `Cloud model` option without a local checkpoint. For one-time setup:

```bash
cp .env.local.example .env.local
```

Open `.env.local` and replace `your-api-key-here` with your key. The file is ignored by Git. After that, start Pixelmate and the bridge normally:

```bash
npm start
```

Optionally select a different image model with `OPENAI_IMAGE_MODEL`; the default is `gpt-image-1`.

The browser talks only to the local bridge. The bridge sends the source sprite and identity notes to the OpenAI Images API and returns PNG frames. Do not put the key in Vite client code, local storage, or a committed file. OpenAI recommends keeping API keys server-side and using environment variables. For a public deployment, replace this local bridge with an authenticated backend.
