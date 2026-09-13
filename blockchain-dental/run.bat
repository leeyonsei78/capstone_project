@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Dental Insurance Blockchain - Starting all services
echo ============================================================

echo [1/6] Starting Hardhat local node...
start "1-Hardhat Node" /d "%~dp0" cmd /k "npx hardhat node"

echo Waiting for node to come up (8 sec)...
timeout /t 8 /nobreak >nul

echo [2/6] Deploying contracts (waiting for completion)...
call npx hardhat run scripts/deploy.js --network localhost
if errorlevel 1 (
    echo.
    echo Deploy failed. Check that the node started correctly.
    pause
    exit /b 1
)

echo [3/6] Starting frontend UI server...
start "3-Frontend UI" /d "%~dp0frontend" cmd /k "npx serve -l 3000 ."

echo [4/6] Starting maturity refund watcher...
start "4-Maturity Watcher" /d "%~dp0" cmd /k "node scripts/maturity-watcher.js"

echo [5/6] Starting oracle service...
start "5-Oracle Service" /d "%~dp0" cmd /k "node scripts/oracle-service.js"

echo [6/6] Starting premium auto-pay scheduler...
start "6-Premium Scheduler" /d "%~dp0" cmd /k "node scripts/premium-scheduler.js"

echo Opening admin window (Chrome) and customer window (Edge) in 3 sec...
timeout /t 3 /nobreak >nul
start chrome "http://localhost:3000"
start msedge "http://localhost:3000"

echo ============================================================
echo   All services started - http://localhost:3000
echo   Chrome = admin account, Edge = customer account
echo   (each browser keeps its own MetaMask account selection)
echo   To fast-forward blockchain time, run in a separate terminal:
echo     node scripts/advance-time.js 600
echo ============================================================
pause
