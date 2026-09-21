import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

doc = docx.Document(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx")

rogue_samples = []
for i, p in enumerate(doc.paragraphs[10:]):
    t = p.text.strip()
    if any(k in t for k in ["河南省中原奥起实业有限公司投标文件", 
                            "内蒙古长城发电有限公司上海庙煤电项目", 
                            "中速磨煤机用过轨起重机设备采购", 
                            "※投标单位：河南圣起机械集团有限公司"]):
        rogue_samples.append((i+10, t))

print(f"Total remaining rogue in 磨煤机: {len(rogue_samples)}")
print("First 15 samples:")
for p_idx, t in rogue_samples[:15]:
    print(f"  P[{p_idx}]: \"{t}\"")
