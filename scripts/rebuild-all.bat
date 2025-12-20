@echo off
REM AITO Complete Rebuild Script (Windows)
REM Rebuilds ALL containers and images from scratch with force create
REM Solves cache issues and ensures all env vars are correct

echo ============================================
echo AITO Complete Rebuild Script (Windows)
echo ============================================
echo.

cd /d "%~dp0\.."
echo Working directory: %CD%
echo.

REM Step 1: Stop ALL running containers
echo Step 1: Stopping all AITO containers...
docker compose --profile agents down --remove-orphans 2>nul
FOR /F "tokens=*" %%i IN ('docker ps -a --filter name^=aito- -q') DO docker rm -f %%i 2>nul
echo All containers stopped and removed
echo.

REM Step 2: Remove ALL AITO images (force)
echo Step 2: Removing all AITO images...
FOR /F "tokens=*" %%i IN ('docker images --format "{{.Repository}}:{{.Tag}}" ^| findstr "shibc-aito"') DO docker rmi -f %%i 2>nul
echo All AITO images removed
echo.

REM Step 3: Prune Docker build cache
echo Step 3: Pruning Docker build cache...
docker builder prune -af 2>nul
echo Build cache cleared
echo.

REM Step 4: Build TypeScript
echo Step 4: Building TypeScript...
call npm run build
if ERRORLEVEL 1 (
    echo TypeScript build failed!
    exit /b 1
)
echo TypeScript built
echo.

REM Step 5: Build ALL images with --no-cache
echo Step 5: Building ALL images with --no-cache...
docker compose build --no-cache --parallel
if ERRORLEVEL 1 (
    echo Image build failed!
    exit /b 1
)
echo All images built from scratch
echo.

REM Step 6: Start infrastructure first
echo Step 6: Starting infrastructure...
docker compose up -d postgres redis ollama qdrant portainer n8n
echo Waiting for infrastructure to be healthy...
timeout /t 10 /nobreak >nul
docker compose up -d orchestrator
echo Waiting for orchestrator to be healthy...
timeout /t 15 /nobreak >nul
echo Infrastructure started
echo.

REM Step 7: Start all agents with force-recreate
echo Step 7: Starting all agents (force-recreate)...
docker compose --profile agents up -d --force-recreate
echo All agents started
echo.

REM Step 8: Verify containers
echo Step 8: Verifying containers...
echo.
echo Running containers:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
echo.

REM Step 9: Verify LLM config
echo Step 9: Verifying LLM configuration...
echo.

FOR %%a IN (ceo cmo cto cfo coo cco dao) DO (
    echo Checking aito-%%a...
    docker inspect aito-%%a --format "{{range .Config.Env}}{{println .}}{{end}}" 2>nul | findstr "LLM_ROUTING_STRATEGY"
)

echo.
echo ============================================
echo REBUILD COMPLETE - CHECK OUTPUT ABOVE
echo All agents should show: LLM_ROUTING_STRATEGY=claude-only
echo ============================================
