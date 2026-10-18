/** @vitest-environment node */

import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  buildBrowserOpenCommand,
  isCiEnvironment,
  openAppInBrowserAfterStart,
  openUrlInDefaultBrowser,
  shouldAutoOpenBrowser,
  type SpawnProcess,
} from "./auto-open";

class FakeChildProcess extends EventEmitter {
  unref = vi.fn();
}

function createSpawnDouble() {
  const children: FakeChildProcess[] = [];

  const spawnDouble = vi.fn(() => {
    const child = new FakeChildProcess();
    children.push(child);
    return child as unknown as ReturnType<SpawnProcess>;
  }) as unknown as SpawnProcess;

  return { spawnDouble, children };
}

describe("browser auto-open policy", () => {
  it("enables auto-open by default", () => {
    expect(shouldAutoOpenBrowser({})).toBe(true);
  });

  it("disables auto-open inside CI environments", () => {
    expect(shouldAutoOpenBrowser({ CI: "true" })).toBe(false);
    expect(shouldAutoOpenBrowser({ CI: "1" })).toBe(false);
  });

  it("treats CI=false as a non-CI environment", () => {
    expect(shouldAutoOpenBrowser({ CI: "false" })).toBe(true);
  });

  it("honors explicit AUTO_OPEN=false over the default", () => {
    expect(shouldAutoOpenBrowser({ AUTO_OPEN: "false" })).toBe(false);
    expect(shouldAutoOpenBrowser({ AUTO_OPEN: "0" })).toBe(false);
    expect(shouldAutoOpenBrowser({ AUTO_OPEN: "no" })).toBe(false);
    expect(shouldAutoOpenBrowser({ AUTO_OPEN: " OFF " })).toBe(false);
  });

  it("lets AUTO_OPEN=true override CI detection", () => {
    expect(shouldAutoOpenBrowser({ CI: "true", AUTO_OPEN: "true" })).toBe(true);
  });

  it("detects CI environments from the CI flag only", () => {
    expect(isCiEnvironment({ CI: "true" })).toBe(true);
    expect(isCiEnvironment({})).toBe(false);
  });
});

describe("browser launcher commands", () => {
  it("uses cmd start with an empty window title on Windows", () => {
    expect(buildBrowserOpenCommand("win32", "http://localhost:3000")).toEqual({
      command: "cmd",
      args: ["/c", "start", '""', "http://localhost:3000"],
    });
  });

  it("uses open on macOS", () => {
    expect(buildBrowserOpenCommand("darwin", "http://localhost:3000")).toEqual({
      command: "open",
      args: ["http://localhost:3000"],
    });
  });

  it("uses xdg-open on Linux", () => {
    expect(buildBrowserOpenCommand("linux", "http://localhost:3000")).toEqual({
      command: "xdg-open",
      args: ["http://localhost:3000"],
    });
  });
});

describe("openUrlInDefaultBrowser", () => {
  it("resolves true once the launcher process spawns", async () => {
    const { spawnDouble, children } = createSpawnDouble();
    const url = "http://localhost:3001";

    const pending = openUrlInDefaultBrowser(url, {
      spawnProcess: spawnDouble,
      platform: "linux",
    });

    children[0].emit("spawn");
    await expect(pending).resolves.toBe(true);

    expect(spawnDouble).toHaveBeenCalledWith("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(children[0].unref).toHaveBeenCalled();
  });

  it("resolves false when no launcher is available", async () => {
    const { spawnDouble, children } = createSpawnDouble();

    const pending = openUrlInDefaultBrowser("http://localhost:3001", {
      spawnProcess: spawnDouble,
      platform: "linux",
    });

    children[0].emit("error", new Error("spawn xdg-open ENOENT"));
    await expect(pending).resolves.toBe(false);
  });

  it("never rejects when spawning throws synchronously", async () => {
    const throwingSpawn = (() => {
      throw new Error("spawn failed");
    }) as unknown as SpawnProcess;

    await expect(
      openUrlInDefaultBrowser("http://localhost:3001", {
        spawnProcess: throwingSpawn,
        platform: "win32",
      }),
    ).resolves.toBe(false);
  });
});

describe("openAppInBrowserAfterStart", () => {
  it("opens the app and logs the URL when enabled", async () => {
    const { spawnDouble, children } = createSpawnDouble();
    const log = vi.fn();
    const logError = vi.fn();

    const pending = openAppInBrowserAfterStart("http://localhost:3001", {
      spawnProcess: spawnDouble,
      platform: "win32",
      log,
      logError,
    });

    children[0].emit("spawn");
    await expect(pending).resolves.toBe(true);

    expect(log).toHaveBeenCalledWith("Opening http://localhost:3001 in your default browser...");
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs a manual URL when no browser launcher is available", async () => {
    const { spawnDouble, children } = createSpawnDouble();
    const log = vi.fn();
    const logError = vi.fn();

    const pending = openAppInBrowserAfterStart("http://localhost:3001", {
      spawnProcess: spawnDouble,
      platform: "linux",
      log,
      logError,
    });

    children[0].emit("error", new Error("spawn xdg-open ENOENT"));
    await expect(pending).resolves.toBe(false);

    expect(logError).toHaveBeenCalledWith(
      "Could not open a browser automatically. Visit http://localhost:3001 manually (set AUTO_OPEN=false to silence this).",
    );
  });

  it("skips launching and logs the manual URL when disabled", async () => {
    const { spawnDouble } = createSpawnDouble();
    const log = vi.fn();

    const previous = process.env.AUTO_OPEN;
    process.env.AUTO_OPEN = "false";
    try {
      await expect(
        openAppInBrowserAfterStart("http://localhost:3001", {
          spawnProcess: spawnDouble,
          platform: "win32",
          log,
        }),
      ).resolves.toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.AUTO_OPEN;
      } else {
        process.env.AUTO_OPEN = previous;
      }
    }

    expect(spawnDouble).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Browser auto-open is disabled. Visit http://localhost:3001 manually.",
    );
  });
});
