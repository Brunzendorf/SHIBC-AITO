#!/bin/bash
# AITO MCP Enforcement Hook
# Blocks creation of executable scripts - agents MUST use spawn_worker with MCP

# Read JSON input from stdin
INPUT=$(cat)

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')

# Blocked extensions
BLOCKED_EXTENSIONS=".js .ts .sh .bash .py .mjs .cjs .rb .pl"

# Check if file has blocked extension
for ext in $BLOCKED_EXTENSIONS; do
  if [[ "$FILE_PATH" == *"$ext" ]]; then
    echo "🚫 AITO ENFORCEMENT: Cannot create executable script files" >&2
    echo "" >&2
    echo "File: $FILE_PATH" >&2
    echo "Blocked extension: $ext" >&2
    echo "" >&2
    echo "✅ CORRECT APPROACH:" >&2
    echo "Use spawn_worker with appropriate MCP server instead:" >&2
    echo '{"actions":[{"type":"spawn_worker","task":"Your task description","servers":["telegram"]}]}' >&2
    echo "" >&2
    echo "Available MCPs: telegram, imagen, fetch, etherscan, filesystem" >&2
    exit 2  # Exit code 2 = block the tool call
  fi
done

# Allow file creation
exit 0
