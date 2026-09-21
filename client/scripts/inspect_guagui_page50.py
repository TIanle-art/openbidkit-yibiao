import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_guagui_export.pdf"
doc = pymupdf.open(pdf_path)

for p_no in [17, 21, 50, 51, 54, 55]:
    page = doc[p_no - 1]
    print(f"\n================ Page {p_no} ================")
    rect = page.rect
    print(f"Rect: {rect.width} x {rect.height}")
    text = page.get_text().strip()
    print(f"Text ({len(text)} chars):\n{text[:150]}")
    imgs = page.get_images()
    print(f"Images count: {len(imgs)}")
    for img in imgs:
        xref = img[0]
        for b in page.get_image_rects(xref):
            print(f"  Img xref={xref}: bbox=({round(b.x0,1)}, {round(b.y0,1)}, {round(b.x1,1)}, {round(b.y1,1)}) w={round(b.width,1)} h={round(b.height,1)}")
