"""把 PDF 里含指定关键词的页面渲染成 PNG，用于人工核对版式。

只渲染命中的页，避免整份招标文件（几十页）全部铺开。

用法（需要 pymupdf，本机在系统 Python 3.12 里）：

    # 1) 先把 docx 转 PDF（Word COM）
    #    $w = New-Object -ComObject Word.Application; $w.Visible = $false
    #    $d = $w.Documents.Open("<docx>", $false, $true)
    #    $d.ExportAsFixedFormat("<pdf>", 17); $d.Close(0); $w.Quit()
    # 2) 再渲染关键页
    "C:/Program Files/Python312/python.exe" render-pages.py <pdf> <输出目录> 关键词1 关键词2 ...

为什么必须有这一步：本项目的版式缺陷（占位符把落款行撑成两行、占位符插进日期
中间）都是**渲染出来才看见**的，断言当时全绿。改完定稿前先自己看一眼。
"""
import sys
import fitz  # pymupdf（系统 Python 3.12 里的导入名仍是 fitz）

pdf_path = sys.argv[1]
out_dir = sys.argv[2]
keywords = sys.argv[3:]

doc = fitz.open(pdf_path)
hits = {}
for index in range(len(doc)):
    text = doc[index].get_text()
    for keyword in keywords:
        if keyword in text and keyword not in hits:
            hits[keyword] = index

for keyword, index in hits.items():
    page = doc[index]
    pix = page.get_pixmap(dpi=110)
    safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in keyword)[:24]
    target = f'{out_dir}/page-{index + 1:03d}-{safe}.png'
    pix.save(target)
    print(f'{keyword} -> 第 {index + 1} 页 -> {target}')

print('总页数', len(doc))
