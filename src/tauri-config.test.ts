import tauriConfig from "../src-tauri/tauri.conf.json";

it("uses the Vite dev server URL in Tauri dev mode", () => {
  expect(tauriConfig.build.devUrl).toBe("http://localhost:5173");
});
