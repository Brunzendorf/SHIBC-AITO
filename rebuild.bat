@echo off
REM AITO Clean Rebuild Script (Windows)
REM Verhindert Cache-Probleme

echo === AITO Clean Rebuild ===
echo.

REM 1. Stop all
echo [1/5] Stopping containers...
docker compose down

REM 2. Build TypeScript
echo [2/5] Building TypeScript...
call npm run build
if %errorlevel% neq 0 exit /b %errorlevel%

REM 3. Remove old images
echo [3/5] Removing old images...
docker compose rm -f
docker rmi -f shibc-aito-orchestrator:latest 2>nul
docker rmi -f shibc-aito-ceo-agent:latest 2>nul
docker rmi -f shibc-aito-cmo-agent:latest 2>nul
docker rmi -f shibc-aito-cto-agent:latest 2>nul
docker rmi -f shibc-aito-cfo-agent:latest 2>nul
docker rmi -f shibc-aito-coo-agent:latest 2>nul
docker rmi -f shibc-aito-cco-agent:latest 2>nul
docker rmi -f shibc-aito-dao-agent:latest 2>nul
docker rmi -f shibc-aito-dashboard:latest 2>nul

REM 4. Build NO CACHE
echo [4/5] Building images (no cache)...
docker compose build --no-cache
if %errorlevel% neq 0 exit /b %errorlevel%

REM 5. Start infrastructure
echo [5/5] Starting infrastructure...
docker compose up -d redis postgres qdrant

echo.
echo === Build Complete! ===
echo.
echo Start services:
echo   All agents:  docker compose --profile agents up -d
echo   CMO only:    docker compose up -d cmo-agent
echo   Dashboard:   docker compose up -d dashboard orchestrator
