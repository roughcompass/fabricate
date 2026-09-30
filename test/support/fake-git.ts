import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Writes an executable shell script that stands in for Git. */
export function fakeExecutable(body: string, name = "git"): { executable: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-git-"));
  const executable = path.join(directory, name);
  fs.writeFileSync(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { executable, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

export interface RecordingGit {
  executable: string;
  argv(): string[];
  env(): Record<string, string>;
  stdin(): string;
  pid(): number;
  cleanup(): void;
}

/**
 * A fake Git that records its exact argv (NUL-separated), environment, stdin,
 * and pid, then runs +body+ to produce output or an exit status.
 */
export function recordingGit(body = "exit 0"): RecordingGit {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recording-git-"));
  const executable = path.join(directory, "git");
  fs.writeFileSync(
    executable,
    `#!/bin/sh
dir='${directory}'
echo $$ > "$dir/pid"
: > "$dir/argv"
for arg in "$@"; do printf '%s\\0' "$arg" >> "$dir/argv"; done
env > "$dir/env"
cat > "$dir/stdin"
${body}
`,
    { mode: 0o755 },
  );
  const read = (file: string) => (fs.existsSync(path.join(directory, file)) ? fs.readFileSync(path.join(directory, file), "utf8") : "");
  return {
    executable,
    argv: () => read("argv").split("\0").slice(0, -1),
    env: () => Object.fromEntries(read("env").split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])),
    stdin: () => read("stdin"),
    pid: () => Number(read("pid").trim()),
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
