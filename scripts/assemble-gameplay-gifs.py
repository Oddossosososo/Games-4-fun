#!/usr/bin/env python3
"""Turn real browser gameplay captures into compact animated GIF thumbnails."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = Path("/tmp/afterglow-gameplay-frames")
OUT = ROOT / "public" / "thumbs"
OUT.mkdir(parents=True, exist_ok=True)
created = 0

for folder in sorted(FRAMES.iterdir()):
    if not folder.is_dir():
        continue
    files = sorted(folder.glob("*.png"))
    if len(files) < 2:
        continue
    images = []
    for filename in files:
        with Image.open(filename) as source:
            frame = source.convert("RGB").resize((320, 180), Image.Resampling.LANCZOS)
            images.append(frame.quantize(colors=96, method=Image.Quantize.MEDIANCUT))
    images[0].save(
        OUT / f"{folder.name}.gif",
        save_all=True,
        append_images=images[1:],
        duration=330,
        loop=0,
        optimize=True,
        disposal=2,
    )
    created += 1
    print(f"Created gameplay GIF: {folder.name}")

expected = len(list(FRAMES.iterdir()))
if created != expected or created == 0:
    raise SystemExit(f"Only {created} of {expected} gameplay GIFs were created.")
print(f"Created {created} real gameplay GIF thumbnails.")
