export interface VerificationWorkspacePaths {
  workspace: string;
  benchmarkRoot?: string;
  home: string;
  temp: string;
}

/** An environment allowlist, not a filesystem/network sandbox. No provider keys or runtime hooks. */
export function gradingEnvironment(frozen: Pick<VerificationWorkspacePaths, "home" | "temp">): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      /^(?:PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|LANG|LC_ALL|LC_CTYPE)$/iu.test(key)
    )
      environment[key] = value;
  }
  return {
    ...environment,
    HOME: frozen.home,
    USERPROFILE: frozen.home,
    APPDATA: frozen.home,
    LOCALAPPDATA: frozen.home,
    TEMP: frozen.temp,
    TMP: frozen.temp,
    TMPDIR: frozen.temp,
    CI: "1",
    SHELRA_TRACE: "off",
    SHELRA_DIAGNOSTICS_LOG: "off",
    SHELRA_AGENT_RUNS: "off",
  };
}
