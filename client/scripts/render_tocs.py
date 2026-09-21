import pymupdf

doc_sading = pymupdf.open(r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_sading_export.pdf")
doc_sading[1].get_pixmap(dpi=150).save("sading_toc_rendered.png") # Page 2

doc_guagui = pymupdf.open(r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_guagui_export.pdf")
doc_guagui[1].get_pixmap(dpi=150).save("guagui_toc_rendered_p2.png") # Page 2
doc_guagui[2].get_pixmap(dpi=150).save("guagui_toc_rendered_p3.png") # Page 3

print("Saved rendered TOC images!")
