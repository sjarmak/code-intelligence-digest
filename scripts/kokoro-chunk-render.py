#!/usr/bin/env python3
"""Render one text chunk to a 24 kHz mono WAV with local Kokoro-82M.

Invoked once per chunk by the durable render path's kokoro adapter
(src/lib/audio/durable/providers/kokoroTts.ts):

    <kokoro-venv>/bin/python scripts/kokoro-chunk-render.py \
        --in chunk.txt --out chunk.wav [--voice am_onyx] [--speed 0.85]

Runs fully offline once the hexgrad/Kokoro-82M weights are in the Hugging
Face cache. Fails loudly (non-zero exit, no partial output file) on empty
input or empty synthesis; the WAV is written to a temp name and renamed so
--out never holds a truncated file.
"""

import argparse
import sys
import warnings
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--voice", default="am_onyx")
    ap.add_argument("--speed", type=float, default=0.85)
    args = ap.parse_args()

    text = Path(args.inp).read_text()
    if not text.strip():
        sys.exit("[kokoro-chunk] input text is empty")

    warnings.filterwarnings("ignore")  # torch RNN/weight_norm deprecation noise
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    segments = [audio for (_, _, audio) in pipe(text, voice=args.voice, speed=args.speed)]
    if not segments:
        sys.exit("[kokoro-chunk] produced no audio segments")
    wav = np.concatenate([s.numpy() if hasattr(s, "numpy") else s for s in segments])

    out = Path(args.out)
    tmp = out.with_name(out.name + ".tmp")
    sf.write(tmp, wav, 24000, format="WAV")
    tmp.replace(out)
    print(f"[kokoro-chunk] {out.name}: {len(wav) / 24000:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
