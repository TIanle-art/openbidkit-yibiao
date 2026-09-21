import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

for name, path in [("赛鼎完美修复版", r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_完美修复版.docx"),
                   ("磨煤机完美修复版", r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx")]:
    doc = docx.Document(path)
    print(f"\n=== {name} Cover Paragraphs ===")
    for i, p in enumerate(doc.paragraphs[:15]):
        txt = p.text.strip()
        align = p.alignment
        runs_desc = []
        for r in p.runs:
            if r.text:
                u = r.underline
                sz = r.font.size.pt if r.font.size else "N/A"
                runs_desc.append(f"'{r.text}'(sz={sz}, u={u})")
        print(f"P[{i}] (align={align}): {' '.join(runs_desc)}")
