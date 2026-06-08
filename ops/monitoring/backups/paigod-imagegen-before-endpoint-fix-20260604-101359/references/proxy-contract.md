# Paigod Image Proxy Contract

Known local configuration:

- Endpoint template: `https://apiproxy.paigod.work/v3/async/{model}`
- Default model: `gpt-image-2-text-to-image`
- Codex text-model provider base URL may be `https://apiproxy.paigod.work/v1`,
  but this image proxy uses the `/v3/async/{model}` route instead.
- The system `.system/imagegen` skill can be overwritten by updates; keep this
  proxy workflow in the personal `paigod-imagegen` skill.

Expected dry-run shape:

```json
{
  "endpoint": "https://apiproxy.paigod.work/v3/async/gpt-image-2-text-to-image",
  "method": "POST",
  "model": "gpt-image-2-text-to-image",
  "request": {
    "prompt": "Primary request: ...",
    "size": "1024x1024",
    "quality": "medium",
    "output_format": "png",
    "n": 1
  }
}
```

If a real request returns only a job id or status JSON, save the response JSON
and inspect it before adding polling behavior.
