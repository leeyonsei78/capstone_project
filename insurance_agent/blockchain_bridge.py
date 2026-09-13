"""
블록체인 덴탈보험(라이나생명 블록체인치아보험) 가입 자동화 브릿지.

보험상담 AI 어시스턴트에서 '블록체인 덴탈보험' 가입을 요청하면,
../blockchain-dental (run.bat과 동일한 순서)의 프로세스를 자동으로 기동하고
관리자용(Chrome) / 고객용(Edge) 화면 2개를 자동으로 연다.
"""

import os
import socket
import subprocess
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKCHAIN_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "blockchain-dental"))
FRONTEND_DIR = os.path.join(BLOCKCHAIN_DIR, "frontend")
CONFIG_JSON = os.path.join(FRONTEND_DIR, "config.json")
SERVICES_MARKER = os.path.join(BLOCKCHAIN_DIR, ".services_started")

HARDHAT_PORT = 8545
FRONTEND_PORT = 3000

_lock = threading.Lock()
_status = {"state": "idle", "message": "", "updated": time.time()}


def _set_status(state, message):
    with _lock:
        _status["state"] = state
        _status["message"] = message
        _status["updated"] = time.time()


def get_status():
    with _lock:
        return dict(_status)


def _is_port_open(port, host="127.0.0.1", timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_for_port(port, timeout=45, interval=1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _is_port_open(port):
            return True
        time.sleep(interval)
    return False


def _start_console(title, command, cwd):
    """run.bat의 start "제목" cmd /k "명령" 과 동일하게 새 콘솔 창에서 실행."""
    subprocess.Popen('start "{}" cmd /k "{}"'.format(title, command), cwd=cwd, shell=True)


def _blockchain_project_exists():
    return os.path.isdir(BLOCKCHAIN_DIR) and os.path.isfile(
        os.path.join(BLOCKCHAIN_DIR, "hardhat.config.js")
    )


def ensure_blockchain_stack():
    """run.bat과 동일한 순서로 블록체인 스택을 idempotent하게 기동한 뒤 화면 2개를 연다."""
    if not _blockchain_project_exists():
        _set_status("error", "블록체인 프로젝트(blockchain-dental)를 찾을 수 없습니다: " + BLOCKCHAIN_DIR)
        return False

    try:
        node_already_running = _is_port_open(HARDHAT_PORT)

        if not node_already_running:
            _set_status("starting_node", "[1/4] 블록체인 노드(Hardhat)를 시작하는 중입니다...")
            _start_console("1-Hardhat Node", "npx hardhat node", BLOCKCHAIN_DIR)
            if not _wait_for_port(HARDHAT_PORT, timeout=40):
                _set_status("error", "블록체인 노드 시작에 실패했습니다 (8545 포트 응답 없음).")
                return False
            # 노드가 막 올라온 직후 RPC 준비 시간을 살짝 확보
            time.sleep(2)

        need_deploy = (not node_already_running) or (not os.path.exists(CONFIG_JSON))
        if need_deploy:
            _set_status("deploying", "[2/4] 스마트 컨트랙트를 배포하는 중입니다...")
            result = subprocess.run(
                "npx hardhat run scripts/deploy.js --network localhost",
                cwd=BLOCKCHAIN_DIR,
                shell=True,
                capture_output=True,
                text=True,
                timeout=120,
                errors="replace",
            )
            if result.returncode != 0:
                tail = (result.stderr or result.stdout or "")[-800:]
                _set_status("error", "컨트랙트 배포에 실패했습니다: " + tail)
                return False

        if not os.path.exists(SERVICES_MARKER):
            _set_status("starting_services", "[3/4] 만기환급·오라클·자동납부·슬랙알림 서비스를 시작하는 중입니다...")
            _start_console("4-Maturity Watcher", "node scripts/maturity-watcher.js", BLOCKCHAIN_DIR)
            _start_console("5-Oracle Service", "node scripts/oracle-service.js", BLOCKCHAIN_DIR)
            _start_console("6-Premium Scheduler", "node scripts/premium-scheduler.js", BLOCKCHAIN_DIR)
            _start_console("7-Slack Notifier", "node scripts/slack-notifier.js", BLOCKCHAIN_DIR)
            with open(SERVICES_MARKER, "w") as f:
                f.write(str(time.time()))

        if not _is_port_open(FRONTEND_PORT):
            _set_status("starting_frontend", "[4/4] 가입 화면(프론트엔드)을 시작하는 중입니다...")
            _start_console("3-Frontend UI", "npx serve -l 3000 .", FRONTEND_DIR)
            if not _wait_for_port(FRONTEND_PORT, timeout=30):
                _set_status("error", "프론트엔드 서버 시작에 실패했습니다 (3000 포트 응답 없음).")
                return False

        _set_status("opening_windows", "관리자(Chrome)·고객(Edge) 가입 화면 2개를 여는 중입니다...")
        url = "http://localhost:{}".format(FRONTEND_PORT)
        subprocess.Popen('start chrome {}'.format(url), cwd=BLOCKCHAIN_DIR, shell=True)
        subprocess.Popen('start msedge {}'.format(url), cwd=BLOCKCHAIN_DIR, shell=True)

        _set_status("ready", "블록체인 덴탈보험 가입 화면이 준비되었습니다. (Chrome=관리자, Edge=고객)")
        return True

    except subprocess.TimeoutExpired:
        _set_status("error", "컨트랙트 배포가 시간 초과되었습니다.")
        return False
    except Exception as exc:
        _set_status("error", "블록체인 서비스 시작 중 오류가 발생했습니다: {}".format(exc))
        return False


_IN_PROGRESS_STATES = {
    "starting_node", "deploying", "starting_services", "starting_frontend", "opening_windows",
}


def start_enrollment_async():
    """이미 진행 중이 아니면 백그라운드 스레드로 블록체인 스택 기동을 시작."""
    with _lock:
        in_progress = _status["state"] in _IN_PROGRESS_STATES
    if in_progress:
        return get_status()

    _set_status("starting_node", "블록체인 덴탈보험 가입 절차를 준비하는 중입니다...")
    threading.Thread(target=ensure_blockchain_stack, daemon=True).start()
    return get_status()
