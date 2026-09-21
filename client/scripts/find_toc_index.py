import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

for name, path in [('赛鼎', r'd:/APPs/Downloads/文件/已生成标书成果/01-赛鼎起重机_原版复刻_高保真旗舰版.docx'),
                   ('磨煤机', r'd:/APPs/Downloads/文件/已生成标书成果/02-磨煤机过轨吊_原版复刻_高保真旗舰版.docx')]:
    d = docx.Document(path)
    toc_idx = None
    body_idx = None
    for i, p in enumerate(d.paragraphs[:120]):
        t = p.text.strip().replace(' ', '').replace('\t', '')
        if '目录' in t and toc_idx is None:
            toc_idx = i
        if toc_idx is not None and i > toc_idx:
            if any(k in t for k in ['1．响应函', '一、投标函', '响应函']) and not any(ch in p.text for ch in ['\t', '...']):
                body_idx = i
                break
    print(f"{name}: TOC at P[{toc_idx}], Body starts at P[{body_idx}]")
