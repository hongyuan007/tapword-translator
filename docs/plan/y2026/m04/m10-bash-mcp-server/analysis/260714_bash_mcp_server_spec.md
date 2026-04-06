# Bash MCP Server — Technical Specification

**Date**: 2026-07-14  
**Status**: Implementing  
**Module**: `mcp-servers/bash-server/`

---

## 1. Overview

A local MCP server that exposes bash command execution and file reading as tools via the Streamable HTTP transport. Runs as a standalone Node.js process on the developer's machine, allowing the TapWord extension's LLM agent to interact with the local filesystem and shell.

### Key Properties

| Property | Value |
|---|---|
| Transport | Streamable HTTP (stateless) |
| Host | `127.0.0.1` (localhost only) |
| Default Port | `3456` |
| Endpoint | `/mcp` |
| Auth | None (local-only) |
| Runtime | Node.js ESM (`.mjs`) |
| Dependencies | `@modelcontextprotocol/sdk`, `express`, `zod` (all from parent project) |

---

## 2. Tools

### 2.1 `run_command`

Execute a bash command on the local machine.

**Input Schema:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | `string` | Yes | — | Bash command to execute |
| `cwd` | `string` | No | `$HOME` | Working directory |
| `timeout` | `number` | No | `30000` | Max execution time (ms), capped at `120000` |

**Behavior:**
- Uses `child_process.exec()` with `/bin/bash` shell
- Command is validated against a blocklist before execution
- On success: returns stdout + stderr combined, exit code
- On timeout: kills process tree, returns partial output + timeout error message
- On blocked command: returns error with reason, no execution

### 2.2 `read_file`

Read a file from the local filesystem.

**Input Schema:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | `string` | Yes | — | Absolute path to the file |
| `encoding` | `string` | No | `"utf-8"` | Text encoding |
| `maxSize` | `number` | No | `1048576` (1 MB) | Max file size in bytes; rejects larger files |

**Behavior:**
- Checks file exists and size before reading
- Rejects files exceeding `maxSize`
- Returns file content as text

---

## 3. Command Safety (Blocklist)

A convenience filter to prevent accidental destructive commands. NOT a security boundary.

### Blocked Patterns

| Category | Pattern | Example |
|---|---|---|
| Root deletion | `rm -rf /` or `rm -rf /*` | `rm -rf /` |
| Filesystem format | `mkfs` | `mkfs.ext4 /dev/sda1` |
| Device write | `dd` with `of=/dev/` | `dd if=x of=/dev/sda` |
| Fork bomb | `:\(\)\{.*\|.*&\}` | `:(){ :|:& };:` |
| Block device write | `> /dev/sd` | `> /dev/sda` |
| Root permission change | `chmod -R 777 /` | `chmod -R 777 /` |
| System path chown | `chown -R` on `/`, `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/boot`, `/sys`, `/proc` | `chown -R root /etc` |
| Shutdown commands | `shutdown`, `reboot`, `halt`, `poweroff` | `shutdown -h now` |
| Init level changes | `init 0`, `init 6` | `init 0` |
| Hex escape bypass | `\x` hex escapes | `\x72\x6d` |
| Unicode bypass | Non-ASCII suspicious chars | Various |

---

## 4. File Structure

```
mcp-servers/bash-server/
├── index.mjs      # Entry point: Express app + MCP server + tool registration
└── safety.mjs     # Command blocklist filter
```

---

## 5. Startup

```bash
# Default
node mcp-servers/bash-server/index.mjs

# Custom port
node mcp-servers/bash-server/index.mjs --port 8080

# Environment variable
PORT=8080 node mcp-servers/bash-server/index.mjs
```

### TapWord Configuration

Add server in MCP settings:
- **URL**: `http://localhost:3456/mcp`
- **Auth**: None

---

## 6. Architecture Notes

- **Stateless transport**: `sessionIdGenerator: undefined` — no session management needed for single-user local use.
- **Single transport instance per request**: Each POST to `/mcp` creates a new `StreamableHTTPServerTransport`, connects it to the server, handles the request, then closes. This follows the SDK's recommended stateless pattern.
- **No build step**: `.mjs` files run directly with Node.js ESM module resolution.
- **Imports from parent `node_modules`**: The server scripts import from the project's installed packages — no separate `package.json` needed.
