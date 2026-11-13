"""
Optimizes the portfolio's robot frames, static images and background videos.
Run it from anywhere; it works on the folder it lives in (the one with index.html):

    pip install pillow
    python optimize-frames.py            # only does work that is out of date
    python optimize-frames.py --force    # redo everything
    python optimize-frames.py --no-video # skip the (slow) ffmpeg step

How it is connected to the website
  1. Frames  frames/frame (N).png  ->  frames/web/frame-N.webp
       The crop box and frame count are READ FROM index.js (the TOTAL and SRC lines),
       so the script and the site can never drift apart. index.js detects frames/web/
       on its own and uses it; without it the site falls back to the original PNGs.
  2. Images  images/*.png|jpg over 300 KB  ->  .webp
       References in index.html, index.css, theme-refresh.css and index.js are
       rewritten to the .webp automatically (favicons are left alone).
  3. Videos  *.mp4  ->  *-opt.mp4  (no audio, H.264, faststart)
       index.html is updated to use the optimized file, but only if it is smaller.

Video step needs ffmpeg (`brew install ffmpeg` / `sudo apt install ffmpeg`).
"""
import argparse
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "frames"
OUT = FRAMES / "web"
IMG = ROOT / "images"
SITE_FILES = ["index.html", "index.css", "theme-refresh.css", "index.js"]

FRAME_SCALE = 0.75            # output size = crop size x this (1040x1200 -> 780x900)
SOURCE_SIZE = (2560, 1440)    # size of the original frames
IMG_MIN_BYTES = 300 * 1024
DEFAULTS = dict(total=120, x=760, y=150, w=1040, h=1200)


def read_site_settings():
    """Pull TOTAL and SRC out of index.js; fall back to the defaults if the lines changed shape."""
    cfg = dict(DEFAULTS)
    js = ROOT / "index.js"
    if js.exists():
        text = js.read_text(encoding="utf-8")
        m = re.search(r"const\s+TOTAL\s*=\s*(\d+)", text)
        s = re.search(r"const\s+SRC\s*=\s*\{\s*x:\s*(\d+)\s*,\s*y:\s*(\d+)\s*,\s*w:\s*(\d+)\s*,\s*h:\s*(\d+)\s*\}", text)
        if m and s:
            cfg.update(total=int(m.group(1)), x=int(s.group(1)), y=int(s.group(2)),
                       w=int(s.group(3)), h=int(s.group(4)))
            print(f"Settings read from index.js: {cfg['total']} frames, crop {cfg['w']}x{cfg['h']} at ({cfg['x']},{cfg['y']})")
            return cfg
    print("WARNING: could not read TOTAL/SRC from index.js, using built-in defaults.")
    return cfg


def rewrite_refs(pairs):
    """Replace each old -> new path in the site's text files. Safe to repeat."""
    if not pairs:
        return
    for name in SITE_FILES:
        f = ROOT / name
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        new = text
        for old, repl in pairs:
            new = re.sub(re.escape(old) + r"(?![\w.-])", repl, new)
        if new != text:
            f.write_text(new, encoding="utf-8")
            print(f"  updated references in {name}")


def up_to_date(dst, src):
    # an empty file is left over from an interrupted run, so it never counts as done
    return dst.exists() and dst.stat().st_size > 0 and dst.stat().st_mtime >= src.stat().st_mtime


def save_webp(im, dst, quality, method):
    """Write to a temp file first, so pressing Ctrl+C can never leave a broken .webp behind."""
    tmp = dst.with_name(dst.name + ".part")
    im.save(tmp, "WEBP", quality=quality, method=method)
    tmp.replace(dst)


def optimize_frames(cfg, force):
    box = (cfg["x"], cfg["y"], cfg["x"] + cfg["w"], cfg["y"] + cfg["h"])
    size = (round(cfg["w"] * FRAME_SCALE), round(cfg["h"] * FRAME_SCALE))
    OUT.mkdir(parents=True, exist_ok=True)
    done = kept = missing = 0
    warned = False
    for n in range(1, cfg["total"] + 1):
        src = FRAMES / f"frame ({n}).png"
        dst = OUT / f"frame-{n}.webp"
        if not src.exists():
            missing += 1
            continue
        if not force and up_to_date(dst, src):
            kept += 1
            continue
        with Image.open(src) as im:
            if im.size != SOURCE_SIZE and not warned:
                print(f"WARNING: {src.name} is {im.size[0]}x{im.size[1]}, the crop in index.js assumes "
                      f"{SOURCE_SIZE[0]}x{SOURCE_SIZE[1]}.")
                warned = True
            im = im.convert("RGBA").crop(box).resize(size, Image.LANCZOS)
            save_webp(im, dst, 80, 4)
        done += 1
        if done % 10 == 0:
            print(f"  ...{done} frames converted", flush=True)
    print(f"Frames: {done} written, {kept} already up to date, {missing} source PNGs missing -> {OUT}")


def optimize_images(force):
    if not IMG.exists():
        return
    pairs = []
    for p in sorted(IMG.iterdir()):
        if p.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        if "favicon" in p.name.lower() or p.stat().st_size <= IMG_MIN_BYTES:
            continue
        dst = p.with_suffix(".webp")
        if force or not up_to_date(dst, p):
            with Image.open(p) as im:
                save_webp(im, dst, 82, 4)
            print(f"Image: {p.name} {p.stat().st_size // 1024} KB -> {dst.name} {dst.stat().st_size // 1024} KB")
        pairs.append((f"images/{p.name}", f"images/{dst.name}"))
    rewrite_refs(pairs)


def optimize_videos(force):
    if not shutil.which("ffmpeg"):
        print("Skipping video optimization: ffmpeg not found in PATH.")
        return
    pairs = []
    for v in sorted(ROOT.glob("*.mp4")):
        if "-opt" in v.name or "optimized" in v.name:
            continue
        opt = v.with_name(v.stem + "-opt.mp4")
        if force or not up_to_date(opt, v):
            print(f"Optimizing video: {v.name} ({v.stat().st_size // 1024} KB)...")
            cmd = ["ffmpeg", "-y", "-i", str(v), "-vcodec", "libx264", "-crf", "28", "-preset", "slow",
                   "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(opt)]
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode != 0:
                print(f"Failed to optimize {v.name}: {r.stderr.decode('utf-8', 'replace')[-500:]}")
                opt.unlink(missing_ok=True)
                continue
        if opt.stat().st_size >= v.stat().st_size:
            print(f"{opt.name} is not smaller than {v.name}; keeping the original.")
            opt.unlink(missing_ok=True)
            continue
        print(f"Video: {v.name} {v.stat().st_size // 1024} KB -> {opt.name} {opt.stat().st_size // 1024} KB")
        pairs.append((v.name, opt.name))
    rewrite_refs(pairs)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--force", action="store_true", help="redo everything, even if outputs are up to date")
    ap.add_argument("--no-video", action="store_true", help="skip the ffmpeg video step")
    args = ap.parse_args()

    if not (ROOT / "index.html").exists():
        print(f"WARNING: no index.html in {ROOT}; place this script next to your site.")
    cfg = read_site_settings()
    optimize_frames(cfg, args.force)
    optimize_images(args.force)
    if not args.no_video:
        optimize_videos(args.force)
    print("Optimization complete!")


if __name__ == "__main__":
    main()