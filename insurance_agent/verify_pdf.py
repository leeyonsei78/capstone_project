import fitz, pdfplumber

PDF = "건강검진_테스트.pdf"
CHECKS = {
    "실명(이종재)": "이종재",
    "원본주민(780807)": "780807",
    "원본검진일(2026.05.11)": "2026.05.11",
    "원본기관코드(13300083)": "13300083",
    "원본처리코드(20260521)": "20260521",
}
GOOD = {
    "가명주민(900101)": "900101",
    "가명검진일(2025.01.15)": "2025.01.15",
    "가명기관코드(99900001)": "99900001",
    "가명처리코드(20250115)": "20250115",
}
# 의료수치 유지 확인
METRICS = ["169.4", "70.2", "108 / 78", "14.2", "83", "234", "47", "188", "149", "1.00", "88", "24", "26", "64"]

print("=== pdfplumber 전체 텍스트 ===")
with pdfplumber.open(PDF) as pdf:
    all_text = ""
    for page in pdf.pages:
        all_text += page.extract_text() or ""

print("[원본 잔존 여부 - 모두 False 이어야 함]")
for label, val in CHECKS.items():
    found = val in all_text
    mark = "FAIL" if found else "OK"
    print(f"  [{mark}] {label}: {found}")

print("[가명 삽입 여부]")
for label, val in GOOD.items():
    found = val in all_text
    mark = "OK" if found else "미삽입(시각적으로는 존재)"
    print(f"  [{mark}] {label}: {found}")

print("[의료수치 유지 여부 - 모두 True 이어야 함]")
for m in METRICS:
    found = m in all_text
    mark = "OK" if found else "FAIL"
    print(f"  [{mark}] {m}: {found}")
