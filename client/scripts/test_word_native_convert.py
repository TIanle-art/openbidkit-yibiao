import os
import sys
import win32com.client
import pymupdf

sys.stdout.reconfigure(encoding='utf-8')

def test_word_convert():
    # 1. Create a 5-page sample PDF of Project 1 (Cover, TOC, Response Letter, Auth, Situation)
    p1 = r"d:/APPs/Downloads/文件/赛鼎 技术文件0818(1).pdf"
    doc1 = pymupdf.open(p1)
    sample_pdf = r"d:/APPs/Downloads/文件/OpenBidKit_Yibiao-main/client/scripts/sample_sading_1_5.pdf"
    sample_doc = pymupdf.open()
    sample_doc.insert_pdf(doc1, from_page=0, to_page=4)
    sample_doc.save(sample_pdf)
    sample_doc.close()
    print("Created sample_sading_1_5.pdf (5 pages)")

    # 2. Use Word COM to open and convert to docx
    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False

    sample_docx = os.path.abspath(r"d:/APPs/Downloads/文件/OpenBidKit_Yibiao-main/client/scripts/sample_sading_word_native.docx")
    if os.path.exists(sample_docx):
        os.remove(sample_docx)

    print("Opening PDF with Microsoft Word 16.0...")
    # wdFormatXMLDocument = 12
    # Open PDF in Word (Word will execute its native PDF Reflow engine)
    doc = word.Documents.Open(os.path.abspath(sample_pdf), ConfirmConversions=False)
    doc.SaveAs2(sample_docx, FileFormat=12)
    doc.Close()
    word.Quit()
    print(f"Successfully converted using Word 16.0 native engine: {sample_docx} ({os.path.getsize(sample_docx)} bytes)")

if __name__ == "__main__":
    test_word_convert()
