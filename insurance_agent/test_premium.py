"""_fill_missing_premiums 디버그 테스트"""
import json, os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import openai

api_key = os.getenv("OPENAI_API_KEY")
print(f"API key: {'있음' if api_key else '없음'}")

dummy_products = {
    "종신보험": {
        "results": [
            {"company": "교보라이프플래닛", "product_name": "(무)교보라이플 종신보험(표준체): 사망보험금",
             "insurance_type": "종신보험", "premium": "보험료 정보 없음", "coverages": ["사망보험금: 1억원"]},
            {"company": "삼성생명", "product_name": "삼성 인터넷 더플러스종신보험(2601): 사망보험금",
             "insurance_type": "종신보험", "premium": "보험료 정보 없음", "coverages": ["사망보험금: 1억원"]},
        ],
        "total_found": 2,
    }
}

# 보험료 없는 상품 수집
age, gender = 48, "남"
missing = []
for ins_type, data in dummy_products.items():
    if not isinstance(data, dict) or "results" not in data:
        continue
    for idx, p in enumerate(data["results"]):
        if p.get("premium") == "보험료 정보 없음":
            missing.append({"key": f"{ins_type}||{idx}", "ins_type": ins_type, "idx": idx,
                            "company": p.get("company",""), "product_name": p.get("product_name",""),
                            "coverages": p.get("coverages",[])[:2]})

print(f"보험료 없는 상품 {len(missing)}개 발견")

lines = []
for m in missing:
    cov = " / ".join(m["coverages"]) if m["coverages"] else ""
    lines.append(f'- key={m["key"]!r}  {m["company"]} {m["product_name"]}'
                 f'{("  보장: " + cov) if cov else ""}')

prompt = (
    f"아래 보험 상품들의 예상 월 보험료를 {age}세 {gender}성 기준(20년납 표준 조건)으로 추정하세요.\n"
    "보험다모아 공시 수준의 현실적인 금액이어야 합니다.\n\n"
    + "\n".join(lines)
    + '\n\n반드시 JSON 객체로만 답하세요: {"key값": "금액원/월", ...}\n'
    '예시: {"종신보험||0": "85,000원/월"}'
)

try:
    client = openai.OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=400,
    )
    raw = resp.choices[0].message.content
    print(f"GPT 응답: {raw}")
    estimates = json.loads(raw)
    for m in missing:
        est = estimates.get(m["key"])
        print(f"  key={m['key']!r} => {est}")
        if est:
            dummy_products[m["ins_type"]]["results"][m["idx"]]["premium"] = f"약 {est} (AI 추정)"
except Exception as e:
    print(f"오류: {e}")

print("\n최종 결과:")
for p in dummy_products["종신보험"]["results"]:
    print(f"  {p['company']}: {p['premium']}")
