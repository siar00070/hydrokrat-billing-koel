"""Cuts the pump photos out of the KFD Varuna catalogue PDF for the dealer page.

    python tools/build_pump_photos.py "KFD Varuna Catalogue.pdf"

Writes small transparent WebP files to dealer-page/img/pumps/. The catalogue has one photo per
pump series, so every model in a series shares its photo. Then run tools/build_dealer_page.js.
"""
import io
import os
import sys

import pymupdf
from PIL import Image

# photo name -> (catalogue page, index of the image on that page, as listed by page.get_images())
PHOTOS = {
    'v3': (29, 1), 'v4': (33, 0), 'v5': (41, 0), 'v6': (44, 0), 'v7': (40, 1), 'v8': (57, 0), 'v9': (68, 0),
    'hmps': (23, 2), 'minihmps': (23, 1), 'ultra': (14, 0), 'vmps': (26, 1),
    'vssp': (17, 0), 'vscp': (17, 1),
    'ivory2': (11, 2), 'topaz': (11, 0), 'supergold': (11, 1), 'emerald': (12, 0), 'vmb': (12, 2),
    'diamond': (12, 1), 'vms': (13, 0), 'vsw': (13, 1), 'vswa': (13, 3), 'vmsjp': (13, 2),
    'crystal': (14, 1), 'pearl': (15, 0), 'boosterpump': (15, 1), 'boosterset': (15, 2),
    'vilc': (16, 2), 'hira': (16, 0), 'ivorypro': (17, 2), 'advantace': (18, 0),
    'cmba': (19, 1), 'cmbb': (21, 1), 'pipe': (73, 1),
}
LAY_FLAT = {'v5', 'v6', 'v7', 'v8', 'v9', 'vmps'}
MAX_SIDE = 300  # pixels on the longest side: sharp enough for a 130 px photo on a phone


def to_pil(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.colorspace is None or pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return Image.open(io.BytesIO(pix.tobytes('png')))


def main(pdf):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dealer-page', 'img', 'pumps')
    os.makedirs(root, exist_ok=True)
    doc = pymupdf.open(pdf)
    for name, (page, index) in PHOTOS.items():
        img = doc[page - 1].get_images(full=True)[index]
        xref, smask = img[0], img[1]
        im = to_pil(doc, xref).convert('RGB')
        if smask:                       # the transparent background is stored as a separate mask
            mask = to_pil(doc, smask).convert('L')
            if mask.size != im.size:
                size = (max(mask.size[0], im.size[0]), max(mask.size[1], im.size[1]))
                im, mask = im.resize(size, Image.LANCZOS), mask.resize(size, Image.LANCZOS)
            im.putalpha(mask)
        box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() if 'A' in im.getbands() else None
        if box:
            im = im.crop(box)
        if name in LAY_FLAT:            # long, thin pumps would be a sliver in a small box
            im = im.rotate(90, expand=True)
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        out = os.path.join(root, name + '.webp')
        im.save(out, 'WEBP', quality=82, method=6)
        print(f'{name:12s} page {page:2d}  {im.size[0]}x{im.size[1]}  {os.path.getsize(out) / 1024:.0f} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
