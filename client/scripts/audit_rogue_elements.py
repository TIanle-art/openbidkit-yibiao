import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

def find_rogue_elements(docx_path, name):
    doc = docx.Document(docx_path)
    print(f"\n=======================================================")
    print(f"  Rogue Elements Audit: {name}")
    print(f"=======================================================")
    
    rogue_paras = []
    for i, p in enumerate(doc.paragraphs):
        t = p.text.strip()
        # Check header text matches
        if any(k in t for k in ["河南省中原奥起实业有限公司投标文件", 
                                "内蒙古长城发电有限公司上海庙煤电项目", 
                                "中速磨煤机用过轨起重机设备采购", 
                                "※投标单位：河南圣起机械集团有限公司",
                                "创新无限，信誉永恒"]):
            # Ignore cover page (p < 10)
            if i > 10:
                rogue_paras.append((i, t[:60]))
                
    print(f"Found {len(rogue_paras)} rogue header/footer paragraphs in body:")
    for i, t in rogue_paras[:10]:
        print(f"  P[{i}]: \"{t}\"")
        
    # Check small logo-like inline shapes
    small_shapes = []
    for i, p in enumerate(doc.paragraphs):
        for r in p.runs:
            # Check drawing in run
            drawings = r._r.findall('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')
            for d in drawings:
                # check ext
                ext = d.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}ext')
                if ext is not None:
                    cx = int(ext.get('cx', 0))
                    cy = int(ext.get('cy', 0))
                    w_in = cx / 914400.0
                    h_in = cy / 914400.0
                    if 0.3 < w_in < 1.5 and 0.3 < h_in < 1.5:
                        small_shapes.append((i, round(w_in, 2), round(h_in, 2), p.text.strip()[:30]))
                        
    print(f"\nFound {len(small_shapes)} rogue small logo drawings in body:")
    for i, w, h, pt in small_shapes[:10]:
        print(f"  P[{i}]: w={w}in, h={h}in, text=\"{pt}\"")

find_rogue_elements(r"d:/APPs/Downloads/文件/已生成标书成果/01-赛鼎起重机_原版复刻_优化版.docx", "赛鼎优化版")
find_rogue_elements(r"d:/APPs/Downloads/文件/已生成标书成果/02-磨煤机过轨吊_原版复刻_优化版.docx", "磨煤机优化版")
