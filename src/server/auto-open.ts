import { spawn } from "child_process";

export const AUTO_OPEN_DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

export type BrowserOpenCommand = {
  command: string;
  args: string[];
};

export type SpawnProcess = typeof spawn;

export interface OpenBrowserDependencies {
  spawnProcess?: SpawnProcess;
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

function normalizeFlag(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

/**
 * Detects common CI environments. Opening a browser inside CI is almost never
 * useful, so the default flips to "disabled" when CI is detected.
 */
export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = normalizeFlag(env.CI);
  return ci !== "" && ci !== "false" && ci !== "0";
}

/**
 * Browser auto-open is enabled by default and can be disabled with
 * AUTO_OPEN=false (also accepts 0 / no / off). An explicit AUTO_OPEN=true
 * overrides CI detection.
 */
export function shouldAutoOpenBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = normalizeFlag(env.AUTO_OPEN);
  if (explicit !== "") {
    return !AUTO_OPEN_DISABLED_VALUES.has(explicit);
  }

  return !isCiEnvironment(env);
}

export function buildBrowserOpenCommand(platform: NodeJS.Platform, url: string): BrowserOpenCommand {
  if (platform === "win32") {
    // `cmd /c start "" <url>`: the empty quoted token is the required window
    // title so the URL is never mistaken for one.
    return { command: "cmd", args: ["/c", "start", '""', url] };
  }

  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  return { command: "xdg-open", args: [url] };
}

/**
 * Fire-and-forget browser launch. Resolves true once the launcher process has
 * been spawned successfully; resolves false (never rejects) when no launcher is
 * available so startup can continue and log a manual URL instead.
 */
export function openUrlInDefaultBrowser(
  url: string,
  dependencies: OpenBrowserDependencies = {},
): Promise<boolean> {
  const platform = dependencies.platform ?? process.platform;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const { command, args } = buildBrowserOpenCommand(platform, url);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (opened: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(opened);
    };

    let child;
    try {
      child = spawnProcess(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      finish(false);
      return;
    }

    child.once("spawn", () => {
      // Detach so the browser survives this server process and never blocks exit.
      child.unref();
      finish(true);
    });

    child.once("error", () => {
      finish(false);
    });
  });
}

/**
 * Opens `url` when auto-open is enabled. Always logs the effective outcome so
 * the user knows which URL to use even when no browser could be launched.
 */
export async function openAppInBrowserAfterStart(
  url: string,
  dependencies: OpenBrowserDependencies = {},
): Promise<boolean> {
  const env = process.env;
  const log = dependencies.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const logError = dependencies.logError ?? ((message: string) => process.stderr.write(`${message}\n`));

  if (!shouldAutoOpenBrowser(env)) {
    log(`Browser auto-open is disabled. Visit ${url} manually.`);
    return false;
  }

  const opened = await openUrlInDefaultBrowser(url, dependencies);
  if (opened) {
    log(`Opening ${url} in your default browser...`);
  } else {
    logError(`Could not open a browser automatically. Visit ${url} manually (set AUTO_OPEN=false to silence this).`);
  }

  return opened;
}
