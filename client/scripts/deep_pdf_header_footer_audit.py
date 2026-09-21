import pymupdf
import sys

sys.stdout.reconfigure(encoding='utf-8')

def audit_headers_footers(pdf_path, name):
    doc = pymupdf.open(pdf_path)
    print(f"\n=======================================================")
    print(f"  Exact Header & Footer Ground Truth: {name}")
    print(f"  Total Pages: {len(doc)}")
    print(f"=======================================================")
    
    header_patterns = {}
    footer_patterns = {}
    header_lines = []
    
    for p_no in range(len(doc)):
        page = doc[p_no]
        rect = page.rect
        
        # Header zone: y < 80
        hdr_rect = pymupdf.Rect(0, 0, rect.width, 80)
        # Footer zone: y > rect.height - 80
        ftr_rect = pymupdf.Rect(0, rect.height - 80, rect.width, rect.height)
        
        # Get text in header zone with font info
        d = page.get_text("dict", clip=hdr_rect)
        hdr_texts = []
        for b in d["blocks"]:
            if "lines" in b:
                for l in b["lines"]:
                    for s in l["spans"]:
                        t = s["text"].strip()
                        if t:
                            hdr_texts.append((t, s["font"], round(s["size"], 1), round(s["bbox"][1], 1)))
                            
        # Check drawings in header zone (lines)
        for dr in page.get_drawings():
            for it in dr["items"]:
                if it[0] == "l":
                    p1, p2 = it[1], it[2]
                    if p1.y < 90 and abs(p1.y - p2.y) < 2:
                        header_lines.append((p_no + 1, round(p1.x,1), round(p1.y,1), round(p2.x,1), dr.get("width", 1)))
                        
        # Get text in footer zone with font info
        df = page.get_text("dict", clip=ftr_rect)
        ftr_texts = []
        for b in df["blocks"]:
            if "lines" in b:
                for l in b["lines"]:
                    for s in l["spans"]:
                        t = s["text"].strip()
                        if t:
                            ftr_texts.append((t, s["font"], round(s["size"], 1), round(s["bbox"][0], 1)))

        hdr_summary = tuple([x[0] for x in hdr_texts])
        ftr_summary = tuple([x[0] for x in ftr_texts])
        
        header_patterns[hdr_summary] = header_patterns.get(hdr_summary, 0) + 1
        footer_patterns[ftr_summary] = footer_patterns.get(ftr_summary, 0) + 1
        
        if p_no < 6 or p_no in [10, 50, 100, 150]:
            print(f"Page {p_no + 1}:")
            print(f"  Header text & fonts: {hdr_texts}")
            print(f"  Footer text & fonts: {ftr_texts}")
            
    print(f"\nHeader line drawings detected in PDF: {len(header_lines)} pages")
    if header_lines:
        print(f"  Sample lines: {header_lines[:5]}")
        
    print(f"\nTop Header Text Patterns:")
    for k, v in sorted(header_patterns.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"  Count {v}: {k}")
        
    print(f"\nTop Footer Text Patterns:")
    for k, v in sorted(footer_patterns.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"  Count {v}: {k}")

audit_headers_footers(r"d:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf", "赛鼎 (Project 1)")
audit_headers_footers(r"d:/APPs/Downloads/文件/圣起过轨吊投标文件.pdf", "圣起 (Project 2)")
