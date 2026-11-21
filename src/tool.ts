/**
 * Runs a command line tool and gives what it printed. Throws with its error output when it exits with an error.
 */
export const runTool = async (tool: string, args: string[], cwd?: string): Promise<string> => {
  const child = Bun.spawn([tool, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${tool} ${args[0] === 'do' || args[0] === 'api' ? args.slice(0, 2).join(' ') : args[0]} failed: ${(stderr || stdout).trim()}`);
  }
  return stdout;
};
