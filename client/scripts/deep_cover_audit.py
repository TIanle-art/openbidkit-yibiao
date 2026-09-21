import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

def dump_page_spans(pdf_path, name, p_no=0):
    doc = pymupdf.open(pdf_path)
    page = doc[p_no]
    text_dict = page.get_text('dict')
    print(f"=== {name} Page {p_no+1} Spans ===")
    for b in text_dict['blocks']:
        if 'lines' in b:
            for l in b['lines']:
                for s in l['spans']:
                    txt = s['text'].strip()
                    if txt:
                        col = hex(s['color'])
                        bbox = [round(x, 1) for x in s['bbox']]
                        print(f"bbox={bbox} sz={s['size']:.1f} col={col} font={s['font']} : \"{txt}\"")
    print(f"--- Drawings on {name} Page {p_no+1} ---")
    for d in page.get_drawings():
        for item in d['items']:
            if item[0] == 'l':
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 2:
                    print(f"H-Line from ({round(p1.x,1)}, {round(p1.y,1)}) to ({round(p2.x,1)}, {round(p2.y,1)})")

dump_page_spans(r'd:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf', '赛鼎 (Project 1)')
print()
dump_page_spans(r'd:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf', '圣起 (Project 2)')
