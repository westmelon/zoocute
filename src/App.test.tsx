import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import App from "./App";

it("renders the ribbon shell with the settings entry", () => {
  render(<App />);
  expect(screen.getByTitle("连接管理")).toBeInTheDocument();
  expect(screen.getByTitle("设置")).toBeInTheDocument();
});

it("starts in connections mode showing the connection list", () => {
  render(<App />);
  expect(screen.getByText("连接管理")).toBeInTheDocument();
  expect(document.querySelector(".server-tabs")).not.toBeInTheDocument();
});

it("opens the settings panel from the ribbon button with readonly selected by default", async () => {
  localStorage.removeItem("zoocute:settings");
  const user = userEvent.setup();

  render(<App />);
  await user.click(screen.getByTitle("设置"));

  expect(screen.getByText("外观")).toBeInTheDocument();
  expect(screen.getByLabelText("只读")).toBeChecked();
});

it("shows a success toast after saving a connection", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.clear(screen.getByLabelText("名称"));
  await user.type(screen.getByLabelText("名称"), "新的本地连接");
  await user.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();
  expect(screen.getByDisplayValue("新的本地连接")).toBeInTheDocument();
});

it("auto-hides the success toast after a short delay", async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);

  await user.clear(screen.getByLabelText("名称"));
  await user.type(screen.getByLabelText("名称"), "新的本地连接");
  await user.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(2500);
  });

  expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  vi.useRealTimers();
});
