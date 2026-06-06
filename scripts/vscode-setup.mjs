import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory (__dirname equivalent in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Helper to create symlinks
function createSymlink(targetPath, linkDir, linkName, type = 'dir') {
  const fullLinkDir = path.join(projectRoot, linkDir);
  const fullLinkPath = path.join(fullLinkDir, linkName);
  
  // Calculate relative target for POSIX
  // targetPath is relative to project root (e.g. "docs/skills")
  // fullLinkDir is where link lives (e.g. "project/.agents")
  // So we want relative from fullLinkDir to targetPath.
  const absoluteTarget = path.join(projectRoot, targetPath);
  const relativeTarget = path.relative(fullLinkDir, absoluteTarget);

  console.log(`Setting up ${path.join(linkDir, linkName)}...`);

  // 1. Create directory if not exists
  if (!fs.existsSync(fullLinkDir)) {
    console.log(`  - Creating directory '${linkDir}'`);
    fs.mkdirSync(fullLinkDir, { recursive: true });
  }

  // 2. Check if link exists
  if (fs.existsSync(fullLinkPath)) {
    const stats = fs.lstatSync(fullLinkPath);
    if (!stats.isSymbolicLink()) {
      console.error(`  - ERROR: '${path.join(linkDir, linkName)}' exists and is NOT a symbolic link.`);
      console.error(`  - Please remove the existing file/directory manually.`);
      process.exit(1);
    }
    console.log(`  - Symlink already exists.`);
    return;
  }

  // 3. Create symlink
  try {
    if (process.platform === 'win32') {
      // Windows: Use Junction (requires absolute path)
      console.log(`  - Creating Junction -> ${absoluteTarget}`);
      fs.symlinkSync(absoluteTarget, fullLinkPath, 'junction');
    } else {
      // macOS/Linux: Use relative symlink
      console.log(`  - Creating Symlink -> ${relativeTarget}`);
      fs.symlinkSync(relativeTarget, fullLinkPath, type); // 'dir' or 'file' hint for Windows
    }
    console.log(`  - Success.`);
  } catch (err) {
    console.error(`  - FAILED: ${err.message}`);
    process.exit(1);
  }
}

console.log("=== VS Code Project Setup ===");
console.log("");

// Task 1: .agents/skills -> docs/skills
createSymlink("docs/skills", ".agents", "skills");

// Task 2: .github/instructions -> docs/instructions
createSymlink("docs/instructions", ".github", "instructions");

// Task 3: CLAUDE.md -> AGENTS.md (file symlink)
createSymlink("AGENTS.md", "", "CLAUDE.md", "file");

console.log("");
console.log("=== Setup Complete ===");
