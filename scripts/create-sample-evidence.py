"""Emit a clearly labelled synthetic PNG test fixture to stdout."""

from PIL import Image, ImageDraw, ImageFont
import sys

im = Image.new("RGB", (960, 640), "#e7edf1")
d = ImageDraw.Draw(im)
font = lambda size: ImageFont.load_default(size=size)
d.rectangle((0, 0, 960, 82), fill="#007da5")
d.text((35, 22), "CAMPUS OPERATIONS / SAMPLE EVIDENCE", font=font(30), fill="white")
d.rounded_rectangle(
    (45, 120, 915, 535), radius=12, fill="#ffffff", outline="#b7cbd6", width=2
)
d.rounded_rectangle(
    (80, 160, 430, 490), radius=10, fill="#d7e2e9", outline="#829ba9", width=3
)
for y in range(190, 380, 22):
    d.line((110, y, 400, y), fill="#9db3c0", width=7)
d.ellipse((205, 402, 245, 442), fill="#bd6c55")
d.text((480, 177), "AHU-01", font=font(42), fill="#244c61")
d.text((480, 240), "Discharge temperature", font=font(23), fill="#6d8898")
d.rounded_rectangle(
    (480, 290, 850, 395), radius=5, fill="#fff5e6", outline="#d6b47d", width=2
)
d.text((505, 310), "39.0 C", font=font(60), fill="#ad7132")
d.text((480, 424), "Configured upper limit: 32 C", font=font(22), fill="#6d8898")
d.text(
    (45, 564),
    "SYNTHETIC TEST IMAGE - NOT A REAL INSPECTION PHOTOGRAPH",
    font=font(22),
    fill="#667f8d",
)
d.text(
    (45, 603),
    "Use this file to demonstrate uploads, validation and evidence retention.",
    font=font(19),
    fill="#8298a5",
)
im.save(sys.stdout.buffer, format="PNG")
