@echo off
REM AITO E2E Test Runner for Windows
REM Usage:
REM   test-e2e.bat                    - Run all E2E tests
REM   test-e2e.bat session-pool       - Run Session Pool tests only
REM   test-e2e.bat integration        - Run integration tests only
REM   test-e2e.bat cleanup            - Cleanup test environment

setlocal enabledelayedexpansion

REM Configuration
set COMPOSE_FILE=docker-compose.test.yml
set RESULTS_DIR=test-results

REM Ensure we're in the project root
cd /d "%~dp0\.."

REM Create results directory
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"

echo ============================================
echo        AITO E2E Test Runner
echo ============================================
echo.

if "%1"=="" goto all
if "%1"=="session-pool" goto session_pool
if "%1"=="integration" goto integration
if "%1"=="unit" goto unit
if "%1"=="all" goto all
if "%1"=="cleanup" goto cleanup
if "%1"=="infra" goto infra
goto usage

:start_infra
echo [%TIME%] Starting test infrastructure...
docker compose -f %COMPOSE_FILE% up -d test-postgres test-redis test-qdrant

echo [%TIME%] Waiting for services to be healthy...
timeout /t 5 /nobreak > nul

REM Wait for PostgreSQL
set ATTEMPTS=0
:wait_postgres
set /a ATTEMPTS+=1
docker compose -f %COMPOSE_FILE% exec -T test-postgres pg_isready -U aito_test > nul 2>&1
if %ERRORLEVEL%==0 (
    echo [PASS] PostgreSQL is ready
    goto postgres_ready
)
if %ATTEMPTS% geq 30 (
    echo [FAIL] PostgreSQL failed to start
    exit /b 1
)
timeout /t 1 /nobreak > nul
goto wait_postgres
:postgres_ready

REM Wait for Redis
set ATTEMPTS=0
:wait_redis
set /a ATTEMPTS+=1
docker compose -f %COMPOSE_FILE% exec -T test-redis redis-cli ping > nul 2>&1
if %ERRORLEVEL%==0 (
    echo [PASS] Redis is ready
    goto redis_ready
)
if %ATTEMPTS% geq 30 (
    echo [FAIL] Redis failed to start
    exit /b 1
)
timeout /t 1 /nobreak > nul
goto wait_redis
:redis_ready

echo [PASS] Test infrastructure is ready
exit /b 0

:stop_infra
echo [%TIME%] Stopping test infrastructure...
docker compose -f %COMPOSE_FILE% down -v
echo [PASS] Test infrastructure stopped
exit /b 0

:integration
call :start_infra
if %ERRORLEVEL% neq 0 exit /b 1

echo [%TIME%] Running integration tests...
docker compose -f %COMPOSE_FILE% run --rm -e TEST_TASKS_JSON="{\"testTasks\":[{\"id\":\"int-1\",\"name\":\"Redis Ping\",\"type\":\"integration\",\"action\":\"ping_redis\"},{\"id\":\"int-2\",\"name\":\"PostgreSQL Ping\",\"type\":\"integration\",\"action\":\"ping_postgres\"}]}" test-agent > "%RESULTS_DIR%\integration-tests.log" 2>&1
if %ERRORLEVEL%==0 (
    echo [PASS] Integration tests passed
) else (
    echo [FAIL] Integration tests failed
)
exit /b %ERRORLEVEL%

:session_pool
call :start_infra
if %ERRORLEVEL% neq 0 exit /b 1

echo [%TIME%] Running Session Pool tests...
docker compose -f %COMPOSE_FILE% --profile session-pool run --rm session-pool-test > "%RESULTS_DIR%\session-pool-tests.log" 2>&1
if %ERRORLEVEL%==0 (
    echo [PASS] Session Pool tests passed
) else (
    echo [FAIL] Session Pool tests failed
)
exit /b %ERRORLEVEL%

:unit
call :start_infra
if %ERRORLEVEL% neq 0 exit /b 1

echo [%TIME%] Running unit tests...
docker compose -f %COMPOSE_FILE% --profile runner run --rm test-runner > "%RESULTS_DIR%\unit-tests.log" 2>&1
if %ERRORLEVEL%==0 (
    echo [PASS] Unit tests passed
) else (
    echo [FAIL] Unit tests failed
)
exit /b %ERRORLEVEL%

:all
call :start_infra
if %ERRORLEVEL% neq 0 exit /b 1

set PASSED=0
set FAILED=0

echo.
echo Running all test suites...
echo.

call :integration
if %ERRORLEVEL%==0 (set /a PASSED+=1) else (set /a FAILED+=1)

echo.
call :session_pool
if %ERRORLEVEL%==0 (set /a PASSED+=1) else (set /a FAILED+=1)

echo.
call :unit
if %ERRORLEVEL%==0 (set /a PASSED+=1) else (set /a FAILED+=1)

echo.
echo ============================================
echo        Test Results Summary
echo ============================================
echo Passed: %PASSED%
echo Failed: %FAILED%
echo.
echo Logs saved to: %RESULTS_DIR%\
echo.

if %FAILED% gtr 0 exit /b 1
exit /b 0

:cleanup
echo [%TIME%] Cleaning up test environment...
call :stop_infra
if exist "%RESULTS_DIR%" rmdir /s /q "%RESULTS_DIR%"
echo [PASS] Cleanup complete
exit /b 0

:infra
call :start_infra
if %ERRORLEVEL% neq 0 exit /b 1
echo [%TIME%] Infrastructure running. Use 'docker compose -f %COMPOSE_FILE% down' to stop.
exit /b 0

:usage
echo Usage: %~nx0 [session-pool^|integration^|unit^|all^|cleanup^|infra]
echo.
echo Commands:
echo   session-pool  - Run Session Pool E2E tests
echo   integration   - Run integration tests (Redis, PostgreSQL)
echo   unit          - Run unit tests
echo   all           - Run all test suites (default)
echo   cleanup       - Stop infrastructure and remove test data
echo   infra         - Start test infrastructure only
exit /b 1
