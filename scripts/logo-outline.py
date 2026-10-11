"""Draw the EuroA11y logo ("a11y", the 11 in yellow, on EU blue) as outlined paths (no font dependency).

Chosen by Antoine on 2026-10-04: Inter Black (SIL OFL), slight gap between the two 1, no EU stars (an emblem
imitation cannot be registered as a trade mark, EUIPO art. 7(1)(h)). Font file expected in ./fonts/, from
https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf ; output in this
script's folder, then copied to assets/ (logo.svg + 512 px PNG rendered in Edge).
"""
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).parent
BLUE, YELLOW, WHITE = "#003399", "#FFCC00", "#FFFFFF"
SIZE, MARGIN = 512, 44
TRACKING = -0.02  # em, between letters
ONE_GAP = 0.04  # em, extra space between the two 1

FONTS = {
    "inter": ("Inter%5Bopsz,wght%5D.ttf", {"wght": 900, "opsz": 32}),
}


def layout(font):
    """Glyph names and x positions (font units) for 'a11y', with kerning ignored and fixed tracking."""
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    upm = font["head"].unitsPerEm
    x, out = 0, []
    for i, ch in enumerate("a11y"):
        name = cmap[ord(ch)]
        out.append((ch, name, x))
        x += hmtx[name][0] + TRACKING * upm
        if i == 1:
            x += ONE_GAP * upm  # the two 1 touch in Inter Black (Antoine, 2026-10-04)
    return out


def render(key, file, axes):
    font = instantiateVariableFont(TTFont(HERE / "fonts" / file), axes)
    glyphs = font.getGlyphSet()
    placed = layout(font)
    # Ink bounds of the whole word, to fit it in the square.
    bounds = BoundsPen(glyphs)
    for _, name, x in placed:
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, x, 0)))
    x0, y0, x1, y1 = bounds.bounds
    scale = (SIZE - 2 * MARGIN) / (x1 - x0)
    dx = MARGIN - x0 * scale
    dy = SIZE / 2 + (y0 + y1) / 2 * scale  # vertical centre of the ink box
    paths = []
    for i, (ch, name, x) in enumerate(placed):
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, dx + x * scale, dy)))
        colour = YELLOW if ch == "1" else WHITE
        paths.append(f'<path fill="{colour}" d="{pen.getCommands()}"/>')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">'
        f'<title>EuroA11y</title><rect width="{SIZE}" height="{SIZE}" fill="{BLUE}"/>{"".join(paths)}</svg>\n'
    )
    (HERE / f"euroa11y-E-{key}.svg").write_text(svg, encoding="utf-8")


for key, (file, axes) in FONTS.items():
    render(key, file, axes)

rows = "".join(
    f'<section><h2>{key}</h2><div class="row">'
    + "".join(
        f'<figure><img src="euroa11y-E-{key}.svg" width="{s}" height="{s}" alt=""><figcaption>{s}</figcaption></figure>'
        for s in (256, 96, 48, 24)
    )
    + f'<figure class="dark"><img src="euroa11y-E-{key}.svg" width="48" height="48" alt=""><figcaption>48 dark</figcaption></figure></div></section>'
    for key in FONTS
)
(HERE / "compare.html").write_text(
    '<!doctype html><meta charset="utf-8"><title>EuroA11y logos</title><style>'
    "body{font:14px system-ui;margin:24px;background:#f4f4f2;color:#111}h2{margin:8px 0}"
    ".row{display:flex;align-items:flex-end;gap:28px;margin-bottom:20px}figure{margin:0;text-align:center}"
    "img{display:block;border-radius:22%}.dark{background:#1e1e1e;color:#ddd;padding:10px;border-radius:8px}"
    f"</style>{rows}",
    encoding="utf-8",
)
print("ok")
