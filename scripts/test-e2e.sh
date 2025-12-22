#!/bin/bash

# AITO E2E Test Runner
# Usage:
#   ./scripts/test-e2e.sh                    # Run all E2E tests
#   ./scripts/test-e2e.sh session-pool       # Run Session Pool tests only
#   ./scripts/test-e2e.sh integration        # Run integration tests only
#   ./scripts/test-e2e.sh cleanup            # Cleanup test environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.test.yml"
TEST_TIMEOUT=300  # 5 minutes per test suite
RESULTS_DIR="./test-results"

# Ensure we're in the project root
cd "$(dirname "$0")/.."

# Print banner
echo -e "${BLUE}"
echo "============================================"
echo "       AITO E2E Test Runner"
echo "============================================"
echo -e "${NC}"

# Create results directory
mkdir -p "$RESULTS_DIR"

# Function: Print status
print_status() {
    echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"
}

# Function: Print success
print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

# Function: Print failure
print_failure() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Function: Print warning
print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Function: Start test infrastructure
start_infra() {
    print_status "Starting test infrastructure..."
    docker compose -f "$COMPOSE_FILE" up -d test-postgres test-redis test-qdrant

    print_status "Waiting for services to be healthy..."
    sleep 5

    # Wait for PostgreSQL
    for i in {1..30}; do
        if docker compose -f "$COMPOSE_FILE" exec -T test-postgres pg_isready -U aito_test > /dev/null 2>&1; then
            print_success "PostgreSQL is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_failure "PostgreSQL failed to start"
            exit 1
        fi
        sleep 1
    done

    # Wait for Redis
    for i in {1..30}; do
        if docker compose -f "$COMPOSE_FILE" exec -T test-redis redis-cli ping > /dev/null 2>&1; then
            print_success "Redis is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_failure "Redis failed to start"
            exit 1
        fi
        sleep 1
    done

    print_success "Test infrastructure is ready"
}

# Function: Stop test infrastructure
stop_infra() {
    print_status "Stopping test infrastructure..."
    docker compose -f "$COMPOSE_FILE" down -v
    print_success "Test infrastructure stopped"
}

# Function: Run integration tests
run_integration_tests() {
    print_status "Running integration tests..."

    local start_time=$(date +%s)

    # Run test-agent with integration test config
    docker compose -f "$COMPOSE_FILE" run --rm \
        -e TEST_TASKS_JSON='{"testTasks":[{"id":"int-1","name":"Redis Ping","type":"integration","action":"ping_redis"},{"id":"int-2","name":"PostgreSQL Ping","type":"integration","action":"ping_postgres"}]}' \
        test-agent 2>&1 | tee "$RESULTS_DIR/integration-tests.log"

    local exit_code=${PIPESTATUS[0]}
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        print_success "Integration tests passed (${duration}s)"
        return 0
    else
        print_failure "Integration tests failed (${duration}s)"
        return 1
    fi
}

# Function: Run Session Pool tests
run_session_pool_tests() {
    print_status "Running Session Pool tests..."

    local start_time=$(date +%s)

    # Check if Claude CLI is authenticated
    if ! docker compose -f "$COMPOSE_FILE" run --rm test-agent claude auth status > /dev/null 2>&1; then
        print_warning "Claude CLI not authenticated - Session Pool tests require Claude"
        print_warning "Run: docker compose -f $COMPOSE_FILE run --rm test-agent claude auth login"
        return 1
    fi

    # Run session-pool-test profile
    docker compose -f "$COMPOSE_FILE" --profile session-pool run --rm session-pool-test 2>&1 | tee "$RESULTS_DIR/session-pool-tests.log"

    local exit_code=${PIPESTATUS[0]}
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        print_success "Session Pool tests passed (${duration}s)"
        return 0
    else
        print_failure "Session Pool tests failed (${duration}s)"
        return 1
    fi
}

# Function: Run unit tests
run_unit_tests() {
    print_status "Running unit tests..."

    local start_time=$(date +%s)

    # Run tests with test runner
    docker compose -f "$COMPOSE_FILE" --profile runner run --rm test-runner 2>&1 | tee "$RESULTS_DIR/unit-tests.log"

    local exit_code=${PIPESTATUS[0]}
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        print_success "Unit tests passed (${duration}s)"
        return 0
    else
        print_failure "Unit tests failed (${duration}s)"
        return 1
    fi
}

# Function: Run all tests
run_all_tests() {
    local passed=0
    local failed=0

    start_infra

    echo ""
    echo -e "${BLUE}Running all test suites...${NC}"
    echo ""

    # Integration tests
    if run_integration_tests; then
        ((passed++))
    else
        ((failed++))
    fi

    # Session Pool tests (optional - requires Claude auth)
    echo ""
    if run_session_pool_tests; then
        ((passed++))
    else
        ((failed++))
    fi

    # Unit tests
    echo ""
    if run_unit_tests; then
        ((passed++))
    else
        ((failed++))
    fi

    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}       Test Results Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo -e "Passed: ${GREEN}$passed${NC}"
    echo -e "Failed: ${RED}$failed${NC}"
    echo ""
    echo "Logs saved to: $RESULTS_DIR/"
    echo ""

    if [ $failed -gt 0 ]; then
        return 1
    fi
    return 0
}

# Function: Cleanup
cleanup() {
    print_status "Cleaning up test environment..."
    stop_infra
    rm -rf "$RESULTS_DIR"
    print_success "Cleanup complete"
}

# Main
case "${1:-all}" in
    "session-pool")
        start_infra
        run_session_pool_tests
        ;;
    "integration")
        start_infra
        run_integration_tests
        ;;
    "unit")
        start_infra
        run_unit_tests
        ;;
    "all")
        run_all_tests
        ;;
    "cleanup")
        cleanup
        ;;
    "infra")
        start_infra
        print_status "Infrastructure running. Use 'docker compose -f $COMPOSE_FILE down' to stop."
        ;;
    *)
        echo "Usage: $0 [session-pool|integration|unit|all|cleanup|infra]"
        echo ""
        echo "Commands:"
        echo "  session-pool  - Run Session Pool E2E tests"
        echo "  integration   - Run integration tests (Redis, PostgreSQL)"
        echo "  unit          - Run unit tests"
        echo "  all           - Run all test suites (default)"
        echo "  cleanup       - Stop infrastructure and remove test data"
        echo "  infra         - Start test infrastructure only"
        exit 1
        ;;
esac
