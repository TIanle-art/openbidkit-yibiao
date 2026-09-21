import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

d = docx.Document(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_完美修复版.docx")

clipped_images = 0
for i, p in enumerate(d.paragraphs):
    has_img = False
    for r in p.runs:
        if r._r.findall('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing'):
            has_img = True
            break
    if has_img:
        pPr = p._p.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr')
        if pPr is not None:
            sp = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing')
            if sp is not None and sp.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}lineRule') == 'exact':
                line_val = sp.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}line')
                clipped_images += 1
                if clipped_images <= 5:
                    print(f"P[{i}] has drawing with EXACT line spacing lineRule=exact, line={line_val} twips! (WILL BE CLIPPED BY WORD!)")

print(f"Total image paragraphs severely clipped by exact line spacing: {clipped_images}")
