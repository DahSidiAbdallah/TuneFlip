import { execSync } from 'node:child_process';
import os from 'node:os';

/**
 * Returns the Windows 8.3 short path for a given path, or the original path if not on Windows or conversion fails.
 */

export function isAscii(str: string): boolean {
  return /^[\x00-\x7F]*$/.test(str);
}

export function getShortPathIfAscii(p: string): string {
  if (os.platform() !== 'win32') return p;
  if (!isAscii(p)) return p;
  try {
    // Use cmd.exe to get the short path
    const stdout = execSync(`for %I in ("${p}") do @echo %~sI`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const shortPath = stdout.trim();
    return shortPath.length > 0 ? shortPath : p;
  } catch {
    return p;
  }
}
