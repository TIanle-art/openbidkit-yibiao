import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx"
d = docx.Document(docx_path)

for i in range(367, 375):
    p = d.paragraphs[i]
    sect = p._p.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sectPr')
    if sect is not None:
        print(f"P[{i}] has sectPr:")
        pgMar = sect.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pgMar')
        if pgMar is not None:
            print("  pgMar:", pgMar.attrib)
        hdr = sect.findall('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}headerReference')
        print("  headers:", [h.attrib for h in hdr])
