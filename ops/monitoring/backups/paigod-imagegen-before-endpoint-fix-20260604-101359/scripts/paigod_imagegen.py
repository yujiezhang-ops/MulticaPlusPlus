#!/usr/bin/env python3
"""Generate images through the Paigod async image proxy."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "gpt-image-2-text-to-image"
DEFAULT_ENDPOINT_TEMPLATE = "https://apiproxy.paigod.work/v3/async/{model}"


def warn(message: str) -> None:
    print(f"Warning: {message}", file=sys.stderr)


def die(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def codex_home() -> Path:
    env_home = os.environ.get("CODEX_HOME")
    if env_home:
        return Path(env_home).expanduser()
    return Path.home() / ".codex"


def load_api_key() -> tuple[str | None, str]:
    env_key = os.environ.get("OPENAI_API_KEY")
    if env_key:
        return env_key, "OPENAI_API_KEY"

    auth_path = codex_home() / "auth.json"
    if auth_path.exists():
        try:
            data = json.loads(auth_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            warn(f"Could not parse {auth_path}: {exc}")
        else:
            key = data.get("OPENAI_API_KEY")
            if isinstance(key, str) and key:
                return key, str(auth_path)

    return None, "missing"


def build_prompt(args: argparse.Namespace) -> str:
    if args.no_augment:
        return args.prompt

    parts = [f"Primary request: {args.prompt}"]
    if args.use_case:
        parts.append(f"Use case: {args.use_case}")
    if args.style:
        parts.append(f"Style/medium: {args.style}")
    if args.composition:
        parts.append(f"Composition/framing: {args.composition}")
    if args.lighting:
        parts.append(f"Lighting/mood: {args.lighting}")
    if args.constraints:
        parts.append(f"Constraints: {args.constraints}")
    if args.avoid:
        parts.append(f"Avoid: {args.avoid}")
    return "\n".join(parts)


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "prompt": build_prompt(args),
    }
    if args.size:
        payload["size"] = args.size
    if args.quality:
        payload["quality"] = args.quality
    if args.output_format:
        payload["output_format"] = args.output_format
    if args.n:
        payload["n"] = args.n
    return payload


def output_paths(out: Path, n: int) -> list[Path]:
    if n <= 1:
        return [out]
    stem = out.stem
    suffix = out.suffix or ".png"
    return [out.with_name(f"{stem}-{idx}{suffix}") for idx in range(1, n + 1)]


def json_default(value: Any) -> str:
    if isinstance(value, Path):
        return str(value)
    return repr(value)


def request_json(url: str, payload: dict[str, Any], api_key: str, timeout: int) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json, image/*",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            content_type = response.headers.get("Content-Type", "")
            return decode_response(raw, content_type)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        die(f"HTTP {exc.code} from Paigod proxy: {raw[:1000]}")
    except urllib.error.URLError as exc:
        die(f"Could not reach Paigod proxy: {exc}")


def decode_response(raw: bytes, content_type: str) -> Any:
    if content_type.startswith("image/"):
        return {
            "_raw_image_b64": base64.b64encode(raw).decode("ascii"),
            "_content_type": content_type,
        }
    text = raw.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"text": text, "_content_type": content_type}


def first_existing(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def collect_images(value: Any) -> list[tuple[str, str]]:
    images: list[tuple[str, str]] = []
    if isinstance(value, dict):
        raw_image = value.get("_raw_image_b64")
        if isinstance(raw_image, str):
            images.append((raw_image, value.get("_content_type", "image/png")))

        b64_value = first_existing(
            value,
            ("b64_json", "base64", "image_base64", "image", "data"),
        )
        if isinstance(b64_value, str) and looks_like_base64_image(b64_value):
            images.append((strip_data_url(b64_value), "image/png"))

        for nested_key in ("images", "data", "result", "results", "output"):
            nested = value.get(nested_key)
            images.extend(collect_images(nested))
    elif isinstance(value, list):
        for item in value:
            images.extend(collect_images(item))
    return images


def collect_urls(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key in ("url", "image_url", "output_url"):
            item = value.get(key)
            if isinstance(item, str) and item.startswith(("http://", "https://")):
                urls.append(item)
        for nested in value.values():
            urls.extend(collect_urls(nested))
    elif isinstance(value, list):
        for item in value:
            urls.extend(collect_urls(item))
    return urls


def strip_data_url(value: str) -> str:
    if value.startswith("data:") and "," in value:
        return value.split(",", 1)[1]
    return value


def looks_like_base64_image(value: str) -> bool:
    clean = strip_data_url(value).strip()
    if len(clean) < 64:
        return False
    return clean.startswith(("iVBOR", "/9j/", "UklGR", "R0lGOD"))


def write_images(images: list[tuple[str, str]], outputs: list[Path], force: bool) -> list[str]:
    written: list[str] = []
    for idx, (image_b64, content_type) in enumerate(images):
        target = outputs[min(idx, len(outputs) - 1)]
        if not target.suffix:
            target = target.with_suffix(extension_for_content_type(content_type))
        ensure_can_write(target, force)
        raw = base64.b64decode(strip_data_url(image_b64))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        written.append(str(target))
    return written


def extension_for_content_type(content_type: str) -> str:
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
    return guessed or ".png"


def write_json_response(response: Any, out: Path, force: bool) -> Path:
    target = out.with_suffix(out.suffix + ".json") if out.suffix else out.with_suffix(".json")
    ensure_can_write(target, force)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def download_urls(urls: list[str], outputs: list[Path], force: bool, timeout: int) -> list[str]:
    written: list[str] = []
    for idx, url in enumerate(urls):
        target = outputs[min(idx, len(outputs) - 1)]
        ensure_can_write(target, force)
        with urllib.request.urlopen(url, timeout=timeout) as response:
            raw = response.read()
            content_type = response.headers.get("Content-Type", "")
        if not target.suffix:
            target = target.with_suffix(extension_for_content_type(content_type))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        written.append(str(target))
    return written


def ensure_can_write(path: Path, force: bool) -> None:
    if path.exists() and not force:
        die(f"Output already exists: {path} (use --force to overwrite)")


def cmd_generate(args: argparse.Namespace) -> None:
    model = args.model
    endpoint = args.endpoint_template.format(model=model)
    out = Path(args.out)
    payload = build_payload(args)
    outputs = output_paths(out, args.n or 1)
    api_key, key_source = load_api_key()

    dry_run_payload = {
        "endpoint": endpoint,
        "method": "POST",
        "model": model,
        "request": payload,
        "outputs": outputs,
        "key_source": key_source if api_key else "missing",
        "has_api_key": bool(api_key),
    }

    if args.dry_run:
        print(json.dumps(dry_run_payload, ensure_ascii=False, indent=2, default=json_default))
        if not api_key:
            warn("No API key found; real generation will fail.")
        return

    if not api_key:
        die("No API key found. Set OPENAI_API_KEY or store OPENAI_API_KEY in Codex auth.json.")

    response = request_json(endpoint, payload, api_key, args.timeout)
    images = collect_images(response)
    urls = collect_urls(response)

    written: list[str] = []
    if images:
        written.extend(write_images(images, outputs, args.force))
    elif urls:
        written.extend(download_urls(urls, outputs, args.force, args.timeout))

    json_path = write_json_response(response, out, args.force if not written else True)
    result = {
        "endpoint": endpoint,
        "model": model,
        "written": written,
        "response_json": str(json_path),
        "response_kind": "image" if written else "json",
        "timestamp": int(time.time()),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate an image")
    generate.add_argument("--prompt", required=True)
    generate.add_argument("--model", default=DEFAULT_MODEL)
    generate.add_argument("--endpoint-template", default=DEFAULT_ENDPOINT_TEMPLATE)
    generate.add_argument("--size", default="1024x1024")
    generate.add_argument("--quality", choices=("low", "medium", "high", "auto"), default="medium")
    generate.add_argument("--output-format", default="png")
    generate.add_argument("--n", type=int, default=1)
    generate.add_argument("--out", default="output/imagegen/output.png")
    generate.add_argument("--timeout", type=int, default=120)
    generate.add_argument("--dry-run", action="store_true")
    generate.add_argument("--force", action="store_true")
    generate.add_argument("--no-augment", action="store_true")
    generate.add_argument("--use-case")
    generate.add_argument("--style")
    generate.add_argument("--composition")
    generate.add_argument("--lighting")
    generate.add_argument("--constraints")
    generate.add_argument("--avoid")
    generate.set_defaults(func=cmd_generate)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
