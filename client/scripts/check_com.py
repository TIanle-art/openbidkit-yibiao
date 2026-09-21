import sys
try:
    import win32com.client
    print("win32com is installed!")
    try:
        w = win32com.client.Dispatch("Word.Application")
        print("Microsoft Word COM is available:", w.Version)
        w.Quit()
    except Exception as e1:
        print("Word.Application COM failed:", e1)
        try:
            wps = win32com.client.Dispatch("kwps.Application")
            print("WPS COM is available:", wps.Version)
            wps.Quit()
        except Exception as e2:
            print("kwps.Application COM failed:", e2)
            try:
                wps2 = win32com.client.Dispatch("wps.Application")
                print("wps.Application COM is available:", wps2.Version)
                wps2.Quit()
            except Exception as e3:
                print("wps.Application COM failed:", e3)
except ImportError:
    print("win32com is not installed.")
