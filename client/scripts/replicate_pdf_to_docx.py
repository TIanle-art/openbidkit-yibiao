import os
import sys
import time
from pdf2docx import Converter

def replicate_pdf_to_docx(pdf_path, docx_path):
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f'PDF not found: {pdf_path}')
    
    print(f'[REPLICATE] Starting high-fidelity replication...')
    print(f'  Input PDF:  {pdf_path}')
    print(f'  Output DOCX: {docx_path}')
    
    t0 = time.time()
    cv = Converter(pdf_path)
    # parse_stream_table=False ensures complex merged tables are parsed stably without skip errors
    cv.convert(docx_path, parse_stream_table=False)
    cv.close()
    
    elapsed = time.time() - t0
    file_size_mb = os.path.getsize(docx_path) / (1024 * 1024)
    print(f'[REPLICATE] Success in {elapsed:.2f}s! Size: {file_size_mb:.2f} MB')
    return {
        'success': True,
        'elapsed': elapsed,
        'file_size_mb': file_size_mb,
        'docx_path': docx_path
    }

if __name__ == '__main__':
    tasks = [
        (
            r'd:\APPs\Downloads\文件\赛鼎 技术文件0818(1).pdf',
            r'd:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻.docx'
        ),
        (
            r'd:\APPs\Downloads\文件\圣起过轨吊投标文件.pdf',
            r'd:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻.docx'
        )
    ]
    for pdf_in, docx_out in tasks:
        replicate_pdf_to_docx(pdf_in, docx_out)
