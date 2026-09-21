import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_guagui_purged.pdf"
doc = pymupdf.open(pdf_path)

print(f"=== Rendered Word PDF Inspection ===")
print(f"Total Pages Rendered by Microsoft Word: {len(doc)}")

blank_pages = []
for p_no in range(len(doc)):
    page = doc[p_no]
    text = page.get_text().strip()
    imgs = page.get_images()
    drawings = page.get_drawings()
    
    # Check if page is blank or nearly blank (e.g. only header/footer or less than 20 chars and no images)
    # Filter out header and footer
    rect = page.rect
    body_rect = pymupdf.Rect(0, 70, rect.width, rect.height - 70)
    body_text = page.get_text("text", clip=body_rect).strip()
    
    # Count images in body
    body_imgs = 0
    for img in imgs:
        xref = img[0]
        for bbox in page.get_image_rects(xref):
            if bbox.y0 >= 60 and bbox.y1 <= rect.height - 60:
                body_imgs += 1
                
    if len(body_text) < 5 and body_imgs == 0:
        blank_pages.append((p_no + 1, len(text), len(imgs)))

print(f"\nTotal Blank / Empty Pages Detected: {len(blank_pages)}")
for p_no, t_len, i_count in blank_pages[:20]:
    print(f"  Page {p_no}: text_len={t_len}, imgs={i_count}")

# Check first 5 pages headers
print("\nFirst 5 pages Header & Footer in Word Rendered PDF:")
for p_no in range(min(5, len(doc))):
    page = doc[p_no]
    rect = page.rect
    hdr_rect = pymupdf.Rect(0, 0, rect.width, 70)
    ftr_rect = pymupdf.Rect(0, rect.height - 70, rect.width, rect.height)
    ht = page.get_text("text", clip=hdr_rect).strip().replace('\n', ' | ')
    ft = page.get_text("text", clip=ftr_rect).strip().replace('\n', ' | ')
    h_imgs = len([img for img in page.get_images() if any(b.y1 <= 80 for b in page.get_image_rects(img[0]))])
    print(f"Page {p_no + 1}:")
    print(f"  Header text: \"{ht}\" (imgs: {h_imgs})")
    print(f"  Footer text: \"{ft}\"")
