import tauriConfig from "../src-tauri/tauri.conf.json";
import mainCapability from "../src-tauri/capabilities/default.json";

it("uses the Vite dev server URL in Tauri dev mode", () => {
  expect(tauriConfig.build.devUrl).toBe("http://localhost:5173");
});

it("starts the main window at a focused tool-sized layout", () => {
  const mainWindow = tauriConfig.app.windows[0];

  expect(mainWindow.width).toBe(1024);
  expect(mainWindow.height).toBe(780);
});

it("grants the main window core Tauri permissions", () => {
  expect(mainCapability.windows).toContain("main");
  expect(mainCapability.permissions).toContain("core:default");
});
