import fitz

REAL_NAME = "이종재"
doc = fitz.open("건강검진.pdf")

for page_num in range(len(doc)):
    page = doc[page_num]
    blocks = page.get_text("dict")["blocks"]
    for b in blocks:
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                t = span["text"]
                if REAL_NAME in t:
                    bbox = span["bbox"]
                    print(f"P{page_num+1} bbox=({bbox[0]:.1f},{bbox[1]:.1f},{bbox[2]:.1f},{bbox[3]:.1f}) size={span['size']:.1f}")
                    print(f"  TEXT: {t[:100]}")

doc.close()
