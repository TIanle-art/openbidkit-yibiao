import os
import zipfile
import docx
import sys

sys.stdout.reconfigure(encoding='utf-8')

def inject_nocompress(docx_path):
    temp_zip = docx_path + ".temp.zip"
    os.rename(docx_path, temp_zip)
    with zipfile.ZipFile(temp_zip, 'r') as zin, zipfile.ZipFile(docx_path, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/settings.xml":
                xml_str = data.decode('utf-8')
                if "<w:doNotCompressPictures" not in xml_str:
                    xml_str = xml_str.replace("</w:settings>", '<w:doNotCompressPictures w:val="1"/></w:settings>')
                    data = xml_str.encode('utf-8')
            zout.writestr(item, data)
    os.remove(temp_zip)

for f in [r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_终极保真版.docx",
          r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx"]:
    inject_nocompress(f)
    print("Injected doNotCompressPictures into:", f)

from audit_flagship import audit_file
audit_file(r"d:\APPs\Downloads\文件\已生成标书成果\01-赛鼎起重机_原版复刻_终极保真版.docx", "赛鼎终极保真版")
audit_file(r"d:\APPs\Downloads\文件\已生成标书成果\02-磨煤机过轨吊_原版复刻_终极保真版.docx", "磨煤机终极保真版")
