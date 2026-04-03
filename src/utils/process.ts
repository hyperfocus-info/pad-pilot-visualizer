function commandString(command: string[]): string {
  return command.map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" ");
}

export async function runCommand(
  command: string[],
  options: {
    cwd?: string;
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
  } = {},
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: options.stdout ?? "pipe",
    stderr: options.stderr ?? "pipe",
  });

  const stdoutPromise =
    proc.stdout && options.stdout !== "inherit" && options.stdout !== "ignore"
      ? new Response(proc.stdout).arrayBuffer().then((buf) => Buffer.from(buf))
      : Promise.resolve(Buffer.alloc(0));
  const stderrPromise =
    proc.stderr && options.stderr !== "inherit" && options.stderr !== "ignore"
      ? new Response(proc.stderr).arrayBuffer().then((buf) => Buffer.from(buf))
      : Promise.resolve(Buffer.alloc(0));

  const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, proc.exited]);

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${commandString(command)}\n${stderr.toString("utf8")}`.trim(),
    );
  }

  return { stdout, stderr };
}
