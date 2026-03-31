import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";

it("renders the ZooCute ribbon shell with only the connections icon on startup", () => {
  render(<App />);
  expect(screen.getByTitle("连接管理")).toBeInTheDocument();
  expect(screen.queryByTitle("节点树")).not.toBeInTheDocument();
  expect(screen.queryByTitle("操作日志")).not.toBeInTheDocument();
});

it("starts in connections mode showing the connection list", () => {
  render(<App />);
  expect(screen.getByText("连接管理")).toBeInTheDocument();
  expect(document.querySelector(".server-tabs")).not.toBeInTheDocument();
});

it("shows a success toast after saving a connection", () => {
  render(<App />);

  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "新的本地连接" },
  });
  fireEvent.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();
  expect(screen.getByDisplayValue("新的本地连接")).toBeInTheDocument();
});

it("auto-hides the success toast after a short delay", async () => {
  vi.useFakeTimers();
  render(<App />);

  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "新的本地连接" },
  });
  fireEvent.click(screen.getByText("保存"));

  expect(screen.getByText("保存成功")).toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(2500);
  });

  expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  vi.useRealTimers();
});
