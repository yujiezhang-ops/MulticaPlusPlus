---
name: paigod-imagegen
description: Use when generating or checking images through the Paigod third-party async image proxy, especially requests mentioning image2, gpt-image-2-text-to-image, apiproxy.paigod.work, /v3/async/{model}, or Codex auth.json image API keys.
---

# Paigod Imagegen

## Overview

Use this personal skill for Paigod's image proxy instead of the system
`imagegen` skill when the request depends on the custom async endpoint:
`https://apiproxy.paigod.work/v3/async/{model}`.

This skill is intentionally stored under the user skill directory, not
`.system`, so system skill updates should not overwrite it.

## Quick Start

Run the bundled script:

```powershell
python "$env:USERPROFILE\.codex\skills\paigod-imagegen\scripts\paigod_imagegen.py" generate `
  --prompt "A simple puppy photo, no text, no watermark" `
  --out "output\imagegen\puppy.png"
```

For a no-network check:

```powershell
python "$env:USERPROFILE\.codex\skills\paigod-imagegen\scripts\paigod_imagegen.py" generate `
  --prompt "Smoke test" `
  --dry-run
```

## Defaults

- Endpoint template: `https://apiproxy.paigod.work/v3/async/{model}`
- Default model: `gpt-image-2-text-to-image`
- Key lookup order:
  1. `OPENAI_API_KEY` environment variable
  2. `%CODEX_HOME%\auth.json`
  3. `%USERPROFILE%\.codex\auth.json`
- Output directory for project-bound assets: `output/imagegen/`

Never print full API keys. It is acceptable to report that a key exists, its
length, or a short prefix when debugging.

## Workflow

1. Use `paigod_imagegen.py generate --dry-run` first to verify endpoint,
   payload, model id, output path, and key source.
2. For a real generation, run the same command without `--dry-run`.
3. Save final project assets under the current repo, normally
   `output/imagegen/`.
4. If the response is an image, the script writes the image file. If the proxy
   returns a job JSON instead, the script writes the JSON response next to the
   requested output so follow-up polling can inspect it.
5. If the endpoint contract changes, inspect the JSON dry-run payload and proxy
   response before editing the script.

## Script

`scripts/paigod_imagegen.py` supports:

- `generate --prompt ...`
- `--model gpt-image-2-text-to-image`
- `--endpoint-template https://apiproxy.paigod.work/v3/async/{model}`
- `--size WIDTHxHEIGHT`
- `--quality low|medium|high|auto`
- `--out output/imagegen/name.png`
- `--dry-run`
- `--force`

Run `--help` for all flags.

## Common Mistakes

- Do not use the system `.system/imagegen/scripts/image_gen.py` for this proxy
  unless it has been explicitly reconfigured; that system skill may be
  overwritten by updates.
- Do not assume `.codex/config.toml` model-provider settings configure this
  image proxy. This skill reads key material from environment/auth.json and uses
  its own endpoint template.
- Do not downgrade to `gpt-image-1.5` unless the user explicitly asks for it.
