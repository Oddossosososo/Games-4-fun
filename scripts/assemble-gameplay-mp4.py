#!/usr/bin/env python3
"""Encode captured gameplay frames as compact, muted, looping MP4 previews."""
from pathlib import Path
import subprocess
import json

ROOT = Path(__file__).resolve().parents[1]
FRAMES = Path("/tmp/afterglow-gameplay-frames")
OUT = ROOT / "public" / "thumbs"
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / "games.json").read_text(encoding="utf-8"))
expected_ids = {game["id"] for game in manifest["games"]}

for game_id in sorted(expected_ids):
    folder = FRAMES / game_id
    files = sorted(folder.glob("*.png")) if folder.is_dir() else []
    if len(files) < 2:
        raise SystemExit("Missing gameplay frames for " + game_id)
    output = OUT / (game_id + ".mp4")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-framerate", "3", "-i", str(folder / "%02d.png"),
        "-an", "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,fps=12,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "30",
        "-movflags", "+faststart", "-t", "4", str(output),
    ], check=True)
    if not output.is_file() or output.stat().st_size == 0:
        raise SystemExit("MP4 encoding failed for " + game_id)
    print("Created MP4 gameplay preview: " + game_id + " (" + str(output.stat().st_size // 1024) + " KB)")

print("Created " + str(len(expected_ids)) + " short MP4 gameplay previews.")
