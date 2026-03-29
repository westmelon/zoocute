import packageJson from "../package.json";

it("uses the tauri cli for desktop dev startup", () => {
  expect(packageJson.scripts["tauri:dev"]).toContain("tauri dev");
});
