import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

for name, path in [('赛鼎', r'd:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf'), ('圣起', r'd:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf')]:
    doc = pymupdf.open(path)
    red_spans = []
    for p_no in range(len(doc)):
        page = doc[p_no]
        d = page.get_text('dict')
        for b in d['blocks']:
            if 'lines' in b:
                for l in b['lines']:
                    for s in l['spans']:
                        col = s['color']
                        r = (col >> 16) & 0xFF
                        g = (col >> 8) & 0xFF
                        b_val = col & 0xFF
                        if r > 150 and g < 100 and b_val < 100:
                            red_spans.append((p_no + 1, s['text'].strip(), hex(col)))
    print(f"=== {name} Red Text Spans (Total: {len(red_spans)}) ===")
    for p_no, t, c in red_spans[:20]:
        print(f"  P.{p_no}: [{c}] \"{t}\"")

import docx
for name, path in [('赛鼎AI', r'd:/APPs/Downloads/文件/已生成标书成果/01-赛鼎起重机_AI生成.docx'), 
                   ('磨煤机AI', r'd:/APPs/Downloads/文件/已生成标书成果/02-磨煤机过轨吊_AI生成.docx'),
                   ('赛鼎原版复刻', r'd:/APPs/Downloads/文件/已生成标书成果/01-赛鼎起重机_原版复刻_优化版.docx'),
                   ('磨煤机原版复刻', r'd:/APPs/Downloads/文件/已生成标书成果/02-磨煤机过轨吊_原版复刻_优化版.docx')]:
    d = docx.Document(path)
    reds = []
    for p_idx, p in enumerate(d.paragraphs[:35]):
        for r in p.runs:
            if r.font.color and r.font.color.rgb:
                rgb = str(r.font.color.rgb).upper()
                if rgb.startswith(('FF', 'E0', 'D0', 'C0')):
                    reds.append((p_idx, r.text, rgb))
    print(f"=== {name} Cover Red Runs: {len(reds)} ===")
    for p_idx, t, rgb in reds[:10]:
        print(f"  P[{p_idx}]: \"{t}\" ({rgb})")

