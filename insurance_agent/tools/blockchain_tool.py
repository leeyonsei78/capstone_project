"""
블록체인 덴탈보험 실시간 조회 도구.

blockchain-dental 스마트컨트랙트(증권/청구/대출/만기)를 챗봇이 직접 읽어
자연어로 답변할 수 있게 한다. Python에 web3 등 새 의존성을 추가하지 않고,
이미 이 프로젝트에 있는 ethers.js 스택을 그대로 재사용하기 위해
blockchain-dental/scripts/query-policy.js(읽기 전용)를 subprocess로 호출한다.
"""

from __future__ import annotations
import json
import re
import socket
import subprocess

import blockchain_bridge

QUERY_SCRIPT = "scripts/query-policy.js"
_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _is_stack_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", blockchain_bridge.HARDHAT_PORT), timeout=1.0):
            return True
    except OSError:
        return False


def get_blockchain_dental_status(wallet_address: str = "") -> str:
    """
    특정 지갑 주소의 블록체인 덴탈보험 실시간 현황(증권/보험료납입/보험금청구/
    약관대출/만기환급, USDC+KRW 통합)을 조회합니다.

    Args:
        wallet_address: 조회할 MetaMask 지갑 주소(0x로 시작). 비어 있으면
            시스템에 등록된 값을 사용하며, 그것도 없으면 오류를 반환합니다.
    """
    if not wallet_address:
        return json.dumps({
            "ok": False,
            "error": (
                "지갑 주소가 없습니다. 사용자에게 MetaMask 지갑 주소(0x로 시작하는 42자)를 "
                "물어보거나, 화면의 '지갑 주소 등록' 입력창에 먼저 등록해달라고 안내하세요."
            ),
        }, ensure_ascii=False)

    if not _ADDRESS_RE.match(wallet_address):
        return json.dumps({
            "ok": False,
            "error": (
                "유효한 지갑 주소 형식이 아닙니다 (0x로 시작하는 42자 주소여야 합니다). "
                "개인키(Private Key)는 여기 입력하면 안 되며, 필요하지도 않습니다."
            ),
        }, ensure_ascii=False)

    if not _is_stack_running():
        return json.dumps({
            "ok": False,
            "error": (
                "블록체인 앱이 아직 실행 중이 아닙니다. 먼저 블록체인 덴탈보험 가입 절차를 "
                "시작해 노드를 켜야 조회할 수 있다고 안내하세요."
            ),
        }, ensure_ascii=False)

    try:
        result = subprocess.run(
            ["node", QUERY_SCRIPT, wallet_address],
            cwd=blockchain_bridge.BLOCKCHAIN_DIR,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except Exception as e:
        return json.dumps({"ok": False, "error": f"블록체인 조회 스크립트 실행 실패: {e}"}, ensure_ascii=False)

    stdout = (result.stdout or "").strip()
    if not stdout:
        detail = (result.stderr or "알 수 없는 오류").strip()[-500:]
        return json.dumps({"ok": False, "error": f"블록체인 조회 결과가 비어 있습니다: {detail}"}, ensure_ascii=False)

    try:
        # 스크립트는 항상 마지막 줄에 결과 JSON 한 줄을 출력한다 (혹시 모를 추가 로그 대비)
        data = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError:
        return json.dumps({"ok": False, "error": "블록체인 조회 결과를 해석하지 못했습니다."}, ensure_ascii=False)

    return json.dumps(data, ensure_ascii=False)
