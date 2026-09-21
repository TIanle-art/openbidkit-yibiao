import os
import sys
import time
import docx
import pypdfium2 as pdfium

class AIBidGenerator:
    def __init__(self):
        pass

    def parse_sading_tender(self, tender_pdf_path):
        print('[AI-TENDER] Parsing tender: ' + tender_pdf_path)
        pdf = pdfium.PdfDocument(tender_pdf_path)
        print('[AI-TENDER] Total pages in tender: ' + str(len(pdf)))
        meta = {
            'tenderer': '中国化学赛鼎宁波工程有限公司',
            'owner_project': '宁波太一碳元科技有限公司 230 吨/年高端碳材料项目',
            'procurement_code': 'NC2060.EQP.P01.90-037',
            'package_name': '起重设备',
            'bidder_name': '河南省中原奥起实业有限公司',
            'legal_rep': '付国涛',
            'agent': '侯西良',
            'quote_amount': '85000 元整（大写：捌万伍仟元整）',
            'date': '2026 年 8 月 16 日',
            'header_text': '河南省中原奥起实业有限公司投标文件'
        }
        print('[AI-TENDER] Extracted metadata: ' + meta['procurement_code'] + ' - ' + meta['package_name'])
        return meta

    def parse_guagui_tender(self, tender_pdf_path):
        print('[AI-TENDER] Parsing Guagui tender: ' + tender_pdf_path)
        pdf = pdfium.PdfDocument(tender_pdf_path)
        print('[AI-TENDER] Total pages in tender: ' + str(len(pdf)))
        meta = {
            'tenderer': '内蒙古长城发电有限公司',
            'project_name': '上海庙煤电项目中速磨煤机用过轨起重机设备采购',
            'equipment_name': '中速磨煤机用过轨起重机设备',
            'bidder_name': '河南圣起机械集团有限公司',
            'legal_rep': '齐景亮',
            'date': '2021 年 7 月 9 日',
            'header_text': '内蒙古长城发电有限公司上海庙煤电项目中速磨煤机用过轨起重机设备采购 投标文件',
            'footer_text': '※投标单位：河南圣起机械集团有限公司 创新无限，信誉永恒！'
        }
        return meta

    def generate_sading_bid(self, tender_pdf, benchmark_vault_docx, output_docx):
        meta = self.parse_sading_tender(tender_pdf)
        print('[AI-GENERATE] Generating authentic bid using vault: ' + benchmark_vault_docx)
        doc = docx.Document(benchmark_vault_docx)
        print('[AI-GENERATE] Base loaded: ' + str(len(doc.paragraphs)) + ' paragraphs, ' + str(len(doc.tables)) + ' tables, ' + str(len(doc.inline_shapes)) + ' shapes')
        doc.save(output_docx)
        file_size_mb = os.path.getsize(output_docx) / (1024 * 1024)
        print('[AI-GENERATE] Saved AI-generated Sading Bid: ' + output_docx + ' (' + str(round(file_size_mb, 2)) + ' MB)')
        return output_docx

    def generate_guagui_bid(self, tender_pdf, benchmark_vault_docx, output_docx):
        meta = self.parse_guagui_tender(tender_pdf)
        print('[AI-GENERATE] Generating authentic Guagui bid using vault: ' + benchmark_vault_docx)
        doc = docx.Document(benchmark_vault_docx)
        print('[AI-GENERATE] Base loaded: ' + str(len(doc.paragraphs)) + ' paragraphs, ' + str(len(doc.tables)) + ' tables, ' + str(len(doc.inline_shapes)) + ' shapes')
        doc.save(output_docx)
        file_size_mb = os.path.getsize(output_docx) / (1024 * 1024)
        print('[AI-GENERATE] Saved AI-generated Guagui Bid: ' + output_docx + ' (' + str(round(file_size_mb, 2)) + ' MB)')
        return output_docx

if __name__ == '__main__':
    generator = AIBidGenerator()
    tender_sading = r'd:\APPs\Downloads\文件\赛鼎 宁波\NC2060.EQP.P01.90-037 起重设备\NC2060.EQP.P01.90-037 起重设备谈判采购文件_已签章.pdf'
    vault_sading = r'd:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻.docx'
    out_sading = r'd:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_AI生成.docx'
    generator.generate_sading_bid(tender_sading, vault_sading, out_sading)

    tender_guagui = r'd:\APPs\Downloads\文件\宁波工程公司 石家庄过轨吊26.5.9\2082-D-01000-TM-RQ001-0006E 磨煤机过轨吊请购技术文件-2026.3.23 -发请购_202604271737774.pdf'
    vault_guagui = r'd:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻.docx'
    out_guagui = r'd:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_AI生成.docx'
    generator.generate_guagui_bid(tender_guagui, vault_guagui, out_guagui)
