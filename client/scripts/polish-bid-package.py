#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
polish-bid-package.py — 出标书后处理（第二轮增强）。

stage1（默认）:
  1) sdt 待填点补真值（营业执照号/经营期限/经营范围/身份证号/公章名/日期/最大月产能…）
  2) 2.2 授权委托书整段按真实历史响应重建（中原奥起 2026-08-16 提交版）
  3) 响应函"我方已经仔细阅读____采购"补项目名称；落款"____年____月____日"补日期
  4) 3.1 插营业执照扫描件、3.2 插 6 张生产/检测设备照片、3.4 插 3 张体系认证证书
     （全部取自中原奥起真实技术文件 media，不编造）
stage2 --toc <pdf>:
  5) 目录行加右对齐前导点制表位 + 各章页码（页码取自插图后转出的 PDF）

用法:
  python polish-bid-package.py stage1 <响应文件.docx> <技术文件.docx>
  python polish-bid-package.py stage2 <响应文件.docx> <插图后的PDF>
"""
import io
import re
import shutil
import sys
import zipfile

import fitz  # pymupdf

DOCX = None
TECH = None

COMPANY = '河南省中原奥起实业有限公司'
ADDRESS = '河南省新乡市长垣市魏庄工业区华豫大道中段路东100米'
BIZ_NO = '91410728394866823A'
DATE_FULL = '2026 年 8 月 16 日'
LEGAL_REP_ID = '410728196210301556'
AGENT_ID = '410728197105170018'
BIZ_SCOPE = ('起重机械、智能停车设备、钢结构桥梁、路桥机械设备、起重配件的研发、设计、'
             '制造、销售、安装服务及进出口业务')
MONTH_CAPACITY = '每月 200 台维修小车'
PROJECT_NAME = '宁波太一碳元科技有限公司230吨/年高端碳材料项目'

# alias -> 值（仅红底占位；签字/盖章/报价类保留人工）
SDT_VALUES = {
    '申请人': COMPANY,
    '申请人名称（公章）': COMPANY,
    '申请人名称（加盖公章）': COMPANY,
    '单位名称（公章）': COMPANY,
    '法定代表人身份证号码': LEGAL_REP_ID,
    '被授权代理人身份证号码': AGENT_ID,
    '日期': DATE_FULL,
    '签字日期': DATE_FULL,
    '经营期限': '长期',
    '营业执照号': BIZ_NO,
    '经营范围': BIZ_SCOPE,
    '备注（最大月生产能力）': MONTH_CAPACITY,
    # 真实历史响应里的生产能力表：已签合同填 '/'、剩余产能与最大产能相同
    '备注（已签合同）': '/',
    '备注（剩余月生产能力）': MONTH_CAPACITY,
    # 采购人公开信息（中国化学赛鼎宁波工程有限公司官网/年报）
    '采购人地址': '浙江省宁波市宁波国家高新区光华路300号赛鼎大厦',
    '采购人电话': '0574-87918666',
}

# 3.2 设备照片 / 3.4 体系证书 / 3.1 营业执照（均来自真实技术文件 media）
TECH_MEDIA = {
    'biz_license': ('word/media/image9.jpeg', '营业执照（三证合一）'),
    'idcards': ('word/media/image8.png',
                '法定代表人及委托代理人身份证复印件（加盖公章）'),
    'm600t': ('word/media/image10.png', '600t 起重机试验台'),
    'juanban': ('word/media/image11.jpeg', '卷板机'),
    'paoWan': ('word/media/image12.png', '抛丸机'),
    'cnc': ('word/media/image13.png', '数控切割机'),
    'weld': ('word/media/image15.png', '自动焊机'),
    'paint': ('word/media/image16.jpeg', '喷砂涂装生产线'),
    'iso9001': ('word/media/image18.png', '质量管理体系认证证书'),
    'iso14001': ('word/media/image19.png', '环境管理体系认证证书'),
    'iso45001': ('word/media/image20.jpeg', '职业健康安全管理体系认证证书'),
    'license_ts': ('word/media/image75.jpeg',
                   '特种设备生产许可证（A级 桥式/门式起重机）'),
    'contract1': ('word/media/image83.jpeg', '同类物资供货合同（框架合同下订单）'),
    'contract2': ('word/media/image84.jpeg', '同类物资供货合同技术附件（首页）'),
    'contract3': ('word/media/image85.jpeg', '同类物资供货合同（续页）'),
}

RPR_BASE = ('<w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" '
            'w:cs="SimSun" /><w:sz w:val="21" /><w:szCs w:val="21" /></w:rPr>')
RPR_U = ('<w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" '
         'w:cs="SimSun" /><w:sz w:val="21" /><w:szCs w:val="21" />'
         '<w:u w:val="single" w:color="auto" /></w:rPr>')

changes = []


def log(msg):
    changes.append(msg)
    print('  *', msg)


def flat(xml):
    return ''.join(re.findall(r'<w:t(?:\s[^>]*)?>([^<]*)</w:t>', xml))


def iter_paragraphs(doc_xml):
    """yield (start, end, body) of each <w:p> (body includes the <w:p> tags)."""
    for m in re.finditer(r'<w:p(?:\s[^>]*)?>[\s\S]*?</w:p>', doc_xml):
        yield m.start(), m.end(), m.group(0)


# ---------------------------------------------------------------- sdt fill
def fill_sdts(doc):
    n = 0

    def repl(m):
        nonlocal n
        block = m.group(0)
        am = re.search(r'<w:alias w:val="([^"]*)" />', block)
        if not am:
            return block
        alias = am.group(1)
        val = SDT_VALUES.get(alias)
        if not val:
            return block
        # 已有真值（非占位）的不动
        tm = re.search(r'<w:t(?:\s[^>]*)?>([^<]*)</w:t>', block)
        if tm and not re.fullmatch(r'【[^】]*】', tm.group(1) or ''):
            return block
        new = re.sub(r'(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)',
                     lambda t: t.group(1) + val + t.group(3), block, count=1)
        # 有值即去红底
        new = new.replace('<w:shd w:val="clear" w:color="auto" w:fill="FCE8E6" />', '')
        n += 1
        return new

    doc = re.sub(r'<w:sdt>[\s\S]*?</w:sdt>', repl, doc)
    log(f'sdt 填值 {n} 处')
    return doc


def strip_date_residue(doc):
    """alias=日期/签字日期 的 sdt 填了完整日期后，同段落 sdt 之后的『年 月 日』残渣清空。"""
    out, n = [], 0
    pos = 0
    for s in re.finditer(r'<w:sdt>[\s\S]*?</w:sdt>', doc):
        block = s.group(0)
        am = re.search(r'<w:alias w:val="(日期|签字日期)" />', block)
        if not am or '【' in flat(block):
            continue
        # 找所在段落
        ps = doc.rfind('<w:p ', 0, s.start())
        ps2 = doc.rfind('<w:p>', 0, s.start())
        ps = max(ps, ps2)
        pe = doc.find('</w:p>', s.end())
        if ps < 0 or pe < 0:
            continue
        pe += len('</w:p>')
        para = doc[ps:pe]
        tail = para[s.end() - ps:]
        tail_new, k = re.subn(r'(<w:t(?:\s[^>]*)?>)[^<]*(</w:t>)',
                              lambda t: t.group(1) + t.group(2), tail)
        if k and re.search(r'年[\s\u3000]*月[\s\u3000]*日', flat(tail)):
            out.append((para, tail, tail_new))
            n += 1
    for para, tail, tail_new in out:
        doc = doc.replace(para, para.replace(tail, tail_new))
    log(f'日期残渣清理 {n} 段')
    return doc


# ------------------------------------------------- underline-slot filling
def fill_slots_in_para(para, values, label):
    """把段落内『带下划线的纯空格 w:t』按顺序填上 values。"""
    slots = list(re.finditer(
        r'(<w:r><w:rPr>(?:(?!</w:r>).)*?<w:u w:val="single"[^>]*/>(?:(?!</w:r>).)*?</w:rPr>)'
        r'(?:<w:t(?:\s[^>]*)?>([\s\u3000]*)</w:t>|<w:t(?:\s[^>]*)?/>|<w:tab ?/>)</w:r>', para))
    slots = [s for s in slots if len(values) > 0]
    if len(slots) < len(values):
        print(f'  ! {label}: 槽位 {len(slots)} < 值 {len(values)}，跳过')
        return para
    # 从后往前替换，避免位置偏移
    for idx, val in reversed(list(enumerate(values))):
        s = slots[idx]
        para = para[:s.start()] + s.group(1) + f'<w:t xml:space="preserve">{val}</w:t></w:r>' \
            + para[s.end():]
    log(f'{label}: 填 {len(values)} 槽')
    return para


def fill_underline_paragraphs(doc):
    # 响应函项目名称：『我方已经仔细阅读____采购（采购编号』
    # （响应文件里同一格式可能出现两份——正文 + 重复格式区，两份都要填）
    n = 0
    for ps, pe, para in list(iter_paragraphs(doc)):
        if '我方已经仔细阅读' in flat(para):
            new_para = fill_slots_in_para(para, [PROJECT_NAME], '响应函项目名')
            if new_para != para:
                doc = doc.replace(para, new_para, 1)
                n += 1
    log(f'响应函项目名 {n} 份')
    # 纯落款段：____年____月____日
    n = 0
    for ps, pe, para in list(iter_paragraphs(doc)):
        if re.fullmatch(r'[\s\u3000]*年[\s\u3000]*月[\s\u3000]*日[\s\u3000]*', flat(para)):
            new_para = fill_slots_in_para(para, ['2026', '8', '16'], '落款日期')
            if new_para != para:
                doc = doc.replace(para, new_para, 1)
                n += 1
    log(f'落款日期段 {n} 处')
    # 2.1 落款段：申请人：____（盖单位章）____年____月____日（全部匹配段）
    for ps, pe, para in list(iter_paragraphs(doc)):
        f = flat(para)
        if '（盖单位章）' in f and '年' in f and '申请人：' in f:
            new_para = fill_slots_in_para(para, [COMPANY, '2026', '8', '16'], '2.1 落款')
            if new_para != para:
                doc = doc.replace(para, new_para, 1)
    return doc


# ----------------------------------------------------- authorization rebuild
AUTH_TEMPLATE = ('本授权书声明：注册于{u}河南{/u}省{u}新乡市{/u}市{u}长垣市{/u}县工商管理局的'
                 '{u}' + COMPANY + '{/u}（单位名称）在下面签字的{u}付国涛、董事长{/u}'
                 '（法定代表人姓名和职务）授权{u}' + COMPANY + '、销售部{/u}'
                 '（单位、部门名称）在下面签字的{u}付强、业务经理{/u}（职务、姓名）'
                 '为本公司的合法代理人，就{u}NC2060.EQP.P01.90-037{/u}（采购编号）'
                 '谈判文件的第{u}赛鼎宁波-宁波太一项目-起重设备{/u}标段（包）响应及'
                 '合同的签订、履行直至完成，并以本公司名义处理一切与之有关的事务。'
                 '本授权书于{u}2026{/u}年{u}8{/u}月{u}16{/u}日签字生效。')


def rebuild_authorization(doc):
    """按真实历史响应重建授权委托书（文档里出现几份就重建几份）。"""
    n = 0
    for ps, pe, para in list(iter_paragraphs(doc)):
        if '本授权书声明' not in flat(para):
            continue
        pm = re.match(r'(<w:p(?:\s[^>]*)?>)(<w:pPr>[\s\S]*?</w:pPr>)?([\s\S]*?)(</w:p>)', para)
        # 解析模板为 (text, underline) 序列
        seq, mode = [], 'n'
        for tok in re.split(r'(\{/?u\})', AUTH_TEMPLATE):
            if tok == '{u}':
                mode = 'u'
            elif tok == '{/u}':
                mode = 'n'
            elif tok:
                seq.append((tok, mode == 'u'))
        runs = []
        for text, u in seq:
            rpr = RPR_U if u else RPR_BASE
            runs.append(f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>')
        new_para = (pm.group(1) + (pm.group(2) or '') + ''.join(runs) + pm.group(4))
        doc = doc.replace(para, new_para, 1)
        n += 1
    log(f'2.2 授权委托书按真实历史版重建 {n} 份')
    return doc


# ------------------------------------------------------------- image insert
NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def image_extent(data, max_w_in, max_h_in):
    """手动解析 PNG/JPEG 头拿宽高（不依赖额外库）。"""
    import struct
    w = h = None
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack('>II', data[16:24])
    elif data[:2] == b'\xff\xd8':  # JPEG
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB):
                h, w = struct.unpack('>HH', data[i + 5:i + 9])
                break
            seglen = struct.unpack('>H', data[i + 2:i + 4])[0]
            i += 2 + seglen
    if not w or not h:
        w, h = 1200, 900
    ratio = w / h
    win = max_w_in
    hin = win / ratio
    if hin > max_h_in:
        hin = max_h_in
        win = hin * ratio
    return int(win * 914400), int(hin * 914400)


def drawing_xml(rid, name, cx, cy, doc_pr_id):
    return (
        '<w:r><w:drawing>'
        f'<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}" /><wp:effectExtent l="0" t="0" r="0" b="0" />'
        f'<wp:docPr id="{doc_pr_id}" name="{name}" /><wp:cNvGraphicFramePr />'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:nvPicPr><pic:cNvPr id="{doc_pr_id}" name="{name}" /><pic:cNvPicPr /></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rid}" /><a:stretch><a:fillRect /></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0" /><a:ext cx="{cx}" cy="{cy}" /></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst /></a:prstGeom></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')


def caption_para(text):
    return ('<w:p><w:pPr><w:jc w:val="center" /><w:spacing w:before="60" w:after="120" /></w:pPr>'
            f'<w:r>{RPR_BASE}<w:t>{text}</w:t></w:r></w:p>')


def image_para(data, rid, name, doc_pr_id, max_w=4.8, max_h=5.6):
    cx, cy = image_extent(data, max_w, max_h)
    return ('<w:p><w:pPr><w:jc w:val="center" /><w:spacing w:before="120" /></w:pPr>'
            + drawing_xml(rid, name, cx, cy, doc_pr_id) + '</w:p>')


def body_start_pos(doc):
    """正文起点：目录区之后的第一个『响应函』标题段。"""
    toc_pe = 0
    for ps, pe, para in iter_paragraphs(doc):
        if flat(para).replace(' ', '') == '目录':
            toc_pe = pe
            break
    for ps, pe, para in iter_paragraphs(doc):
        if ps < toc_pe:
            continue
        f = flat(para).replace(' ', '').replace('．', '.').replace('.', '')
        if f.startswith('1响应函') or f.startswith('1．响应函'):
            return ps
    return toc_pe


def insert_images(doc, zout_entries):
    """在锚点段落后插图（锚点只从正文区找，避免插进目录）。返回 (doc, 追加 media)。"""
    tz = zipfile.ZipFile(TECH)
    added = []
    body_start = body_start_pos(doc)

    def anchor_iter(doc, needle, last=True):
        """默认取最后一个匹配（目录行在前、正文标题在后）。
        last=False 时返回所有匹配（重复格式区也要插图）。"""
        hits = [(ps, pe, para) for ps, pe, para in iter_paragraphs(doc)
                if needle in flat(para)]
        if not hits:
            return None
        return hits[-1] if last else hits

    plan = [
        # (锚点文本, [(media key, 图注, 宽上限)], 是否插到每个匹配处)
        ('应附申请人营业执照副本及其年检合格的证明材料',
         [('biz_license', 3.9)], False),
        ('附生产企业的主要生产设备型号、台套数',
         [('m600t', 4.8), ('juanban', 4.4), ('paoWan', 4.4),
          ('cnc', 4.4), ('weld', 4.4), ('paint', 4.8)], False),
        ('3.4 质量保证能力证明',
         [('license_ts', 4.2), ('iso9001', 3.9), ('iso14001', 3.9),
          ('iso45001', 3.9)], False),
        # 2.2 授权委托书后附身份证复印件（正文 + 重复格式区各一份）
        ('被授权代理人身份证号码', [('idcards', 4.6)], True),
        # 3.5 业绩表：同类物资合同协议书复印件
        ('应附中标通知书或成交通知书',
         [('contract1', 4.6), ('contract2', 4.6), ('contract3', 4.6)], False),
    ]
    doc_pr = 900
    rid_n = 2000
    inserts = []  # (位置, xml)
    for needle, items, every in plan:
        hit = anchor_iter(doc, needle, last=not every)
        if not hit:
            print(f'  ! 未找到锚点: {needle}')
            continue
        targets = hit if every else [hit]
        for ps, pe, para in targets:
            block = []
            for key, maxw in items:
                path, caption = TECH_MEDIA[key]
                data = tz.read(path)
                ext = path.rsplit('.', 1)[-1].lower()
                rid = f'rIdP{rid_n}'
                rid_n += 1
                mname = f'media/polish_{rid_n}.{ "jpeg" if ext in ("jpg","jpeg") else ext }'
                zout_entries.append((f'word/{mname}', data))
                added.append((rid, mname,
                              'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'))
                doc_pr += 1
                block.append(image_para(data, rid, key, doc_pr, maxw, 5.6))
                block.append(caption_para(f'图{doc_pr - 900}  {caption}'))
            inserts.append((pe, ''.join(block)))
            log(f'锚点「{needle[:18]}…」后插 {len(items)} 图')
    for pos, xml in sorted(inserts, key=lambda t: -t[0]):
        doc = doc[:pos] + xml + doc[pos:]
    tz.close()
    return doc, added


def patch_content_types(ct):
    add = ''
    if 'Extension="png"' not in ct:
        add += '<Default Extension="png" ContentType="image/png" />'
    if 'Extension="jpeg"' not in ct:
        add += '<Default Extension="jpeg" ContentType="image/jpeg" />'
    if 'Extension="jpg"' not in ct:
        add += '<Default Extension="jpg" ContentType="image/jpeg" />'
    if add:
        ct = ct.replace('</Types>', add + '</Types>')
    return ct


def patch_rels(rels, added):
    add = ''.join(
        f'<Relationship Id="{rid}" '
        f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
        f'Target="{target}" />' for rid, target, _ in added)
    return rels.replace('</Relationships>', add + '</Relationships>')


# --------------------------------------------------------------------- TOC
def apply_toc(doc, pdf_path):
    d = fitz.open(pdf_path)
    # 目录段落范围：从『目   录』标题后到第一个正文段『1．响应函』前
    toc_start = None
    for ps, pe, para in iter_paragraphs(doc):
        f = flat(para).replace(' ', '')
        if f == '目录':
            toc_start = pe
            break
    if toc_start is None:
        print('  ! 未找到目录标题')
        return doc
    # 右制表位位置：由 sectPr 计算
    sm = re.search(r'<w:pgSz w:w="(\d+)"', doc)
    mm = re.search(r'<w:pgMar[^>]*w:right="(\d+)"[^>]*w:left="(\d+)"', doc) or \
        re.search(r'<w:pgMar[^>]*w:left="(\d+)"[^>]*w:right="(\d+)"', doc)
    tabpos = 8789
    if sm and mm:
        g = mm.groups()
        right, left = (int(g[0]), int(g[1])) if 'w:right' in doc[mm.start():mm.start()+30] else (int(g[1]), int(g[0]))
        tabpos = int(sm.group(1)) - left - right
    entries = []
    for ps, pe, para in list(iter_paragraphs(doc)):
        if ps < toc_start:
            continue
        f = flat(para).strip()
        if re.match(r'^\d+(\.\d+)*[\.．]', f) and 'ps' != 'x':
            entries.append((ps, pe, para, f))
        if f.startswith('1．响应函'):
            break
    n = 0
    for ps, pe, para, f in reversed(entries):
        num = re.match(r'^(\d+(?:\.\d+)*)', f).group(1)
        title = re.sub(r'^\d+(?:\.\d+)*[\.．]', '', f)
        # 在 PDF 中找该编号标题所在页（跳过目录页）
        page = find_page(d, num, title, toc_pages(d))
        if page is None:
            continue
        para = re.sub(r'<w:pPr([^>]*)/>',
                      lambda m: f'<w:pPr{m.group(1)}>'
                      f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{tabpos}" /></w:tabs>',
                      para, count=1)
        if '<w:tabs>' not in para:
            # pPr 成对标签的情况
            para = para.replace('</w:pPr>',
                                f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{tabpos}" /></w:tabs></w:pPr>', 1)
        tabrun = (f'<w:r>{RPR_BASE}<w:tab /></w:r>'
                  f'<w:r>{RPR_BASE}<w:t>{page}</w:t></w:r>')
        para = para.replace('</w:p>', tabrun + '</w:p>')
        doc = doc[:ps] + para + doc[pe:]
        n += 1
    log(f'目录页码写入 {n} 行')
    d.close()
    return doc


def find_page(d, num, title, skip_pages):
    """按编号+标题在 PDF 中找标题页。
    整数章号后必须跟点；行内与标题字符交集 ≥2 才算命中（排除 4.1 内部编号条目）。"""
    if '.' in num:
        pat_head = re.compile(r'^\s*' + re.escape(num) + r'(?=[\s])')
        pat_sub = re.compile(r'(?<![\d.])' + re.escape(num) + r'(?=[\s])')
    else:
        pat_head = re.compile(r'^\s*' + re.escape(num) + r'(?=[\.．])')
        pat_sub = re.compile(r'(?<![\d.])' + re.escape(num) + r'(?=[\.．])')
    tset = set(title.replace(' ', ''))
    for pass_no, pat in enumerate([pat_head, pat_sub]):
        for pno in range(d.page_count):
            if pno in skip_pages:
                continue
            for line in d[pno].get_text().split('\n'):
                s = line.strip()
                if not s or re.fullmatch(r'\d+', s):
                    continue  # 页脚页码
                if pat.search(s if pass_no else line) and len(tset & set(s.replace(' ', ''))) >= 2:
                    return pno + 1
    return None


def toc_pages(d):
    """目录页集合：含 ≥5 行『编号.』开头的行。"""
    pages = set()
    for pno in range(d.page_count):
        lines = d[pno].get_text().split('\n')
        if sum(1 for l in lines if re.match(r'^\s*\d+(\.\d+)*[\.\．]\S', l)) >= 15:
            pages.add(pno)
    return pages


# -------------------------------------------------------------------- main
def main():
    global DOCX, TECH
    mode = sys.argv[1] if len(sys.argv) > 1 else 'stage1'
    DOCX = sys.argv[2]
    if mode == 'stage1':
        TECH = sys.argv[3]
        shutil.copy2(DOCX, DOCX + '.bak')
        zin = zipfile.ZipFile(DOCX)
        doc = zin.read('word/document.xml').decode('utf-8')
        doc = fill_sdts(doc)
        doc = strip_date_residue(doc)
        doc = rebuild_authorization(doc)
        doc = fill_underline_paragraphs(doc)
        media, added = [], []
        doc, added = insert_images(doc, media)
        ct = patch_content_types(zin.read('[Content_Types].xml').decode('utf-8'))
        rels = patch_rels(zin.read('word/_rels/document.xml.rels').decode('utf-8'), added)
        from xml.dom import minidom
        minidom.parseString(doc.encode('utf-8'))  # 防呆：XML 必须合法才能落盘
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr(item, doc)
                elif item.filename == '[Content_Types].xml':
                    zout.writestr(item, ct)
                elif item.filename == 'word/_rels/document.xml.rels':
                    zout.writestr(item, rels)
                else:
                    zout.writestr(item, zin.read(item.filename))
            for name, data in media:
                zout.writestr(name, data)
        zin.close()
        open(DOCX, 'wb').write(buf.getvalue())
        print(f'stage1 完成: {len(changes)} 项改动')
    elif mode == 'stage2':
        pdf = sys.argv[3]
        zin = zipfile.ZipFile(DOCX)
        doc = zin.read('word/document.xml').decode('utf-8')
        doc = apply_toc(doc, pdf)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                zout.writestr(item, doc if item.filename == 'word/document.xml'
                              else zin.read(item.filename))
        zin.close()
        open(DOCX, 'wb').write(buf.getvalue())
        print('stage2 完成')


if __name__ == '__main__':
    main()
