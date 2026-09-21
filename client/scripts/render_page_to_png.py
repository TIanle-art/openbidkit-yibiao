import pymupdf

doc = pymupdf.open(r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_guagui_export.pdf")
page = doc[49] # page 50
pix = page.get_pixmap(dpi=150)
pix.save("page_50_rendered.png")
print(f"Saved page_50_rendered.png: size={pix.width}x{pix.height}")

doc_orig = pymupdf.open(r"d:\APPs\Downloads\文件\圣起过轨吊投标文件.pdf")
page_orig = doc_orig[49]
pix_orig = page_orig.get_pixmap(dpi=150)
pix_orig.save("page_50_original.png")
print(f"Saved page_50_original.png: size={pix_orig.width}x{pix_orig.height}")
