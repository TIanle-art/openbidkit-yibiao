import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

d = docx.Document(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_高保真旗舰版.docx")
print("=== 磨煤机 TOC Paragraphs (P[8] to P[72]) ===")
for i in range(8, 73):
    p = d.paragraphs[i]
    print(f"P[{i}]: \"{p.text.strip()}\"")
