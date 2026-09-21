import os
import sys
import win32com.client

sys.stdout.reconfigure(encoding='utf-8')

def test_word_export_pdf():
    docx_path = os.path.abspath(r"d:\APPs\Downloads\文件\已生成标书成果\test_guagui_purged.docx")
    out_pdf = os.path.abspath(r"d:\APPs\Downloads\文件\OpenBidKit_Yibiao-main\client\scripts\test_guagui_purged.pdf")


    
    if os.path.exists(out_pdf):
        os.remove(out_pdf)
        
    print(f"Opening {docx_path} in Word COM...")
    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    
    try:
        doc = word.Documents.Open(docx_path, ReadOnly=True, ConfirmConversions=False)
        print("Exporting to PDF...")
        # 17 = wdFormatPDF
        doc.SaveAs2(out_pdf, FileFormat=17)
        doc.Close(False)
        print(f"Successfully exported: {out_pdf} ({os.path.getsize(out_pdf)} bytes)")
    except Exception as e:
        print(f"Export failed: {e}")
    finally:
        word.Quit()

if __name__ == "__main__":
    test_word_export_pdf()
