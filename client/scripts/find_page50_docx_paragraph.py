import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx"
d = docx.Document(docx_path)

for i in [367, 368, 369]:
    p = d.paragraphs[i]
    print(f"=== P[{i}] ===")
    print(f"Text: \"{p.text}\"")
    print(f"XML: {p._p.xml}")
