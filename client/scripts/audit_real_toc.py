import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

def dump_toc(pdf_path, name, pages):
    doc = pymupdf.open(pdf_path)
    print(f"=== {name} Real TOC in PDF ===")
    for p_no in pages:
        page = doc[p_no - 1]
        print(f"--- Page {p_no} ---")
        lines = page.get_text("text").splitlines()
        for line in lines:
            line_str = line.strip()
            if line_str:
                print(f"  {line_str}")

dump_toc(r"d:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf", "赛鼎", [2])
print()
dump_toc(r"d:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf", "圣起", [2, 3])
