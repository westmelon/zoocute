import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NodeContentPanel } from "./node-content-panel";

it("shows raw textarea in raw mode", () => {
  render(
    <NodeContentPanel
      value="hello world"
      viewMode="raw"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveValue("hello world");
});

it("textarea is readonly when not editing", () => {
  render(
    <NodeContentPanel
      value="hello"
      viewMode="raw"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
});

it("textarea is editable when editing", () => {
  render(
    <NodeContentPanel
      value="hello"
      viewMode="raw"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
});

it("calls onChange when user types in raw edit mode", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <NodeContentPanel
      value=""
      viewMode="raw"
      isEditing={true}
      onChange={onChange}
      onFallbackToRaw={vi.fn()}
    />
  );
  await user.type(screen.getByRole("textbox"), "x");
  expect(onChange).toHaveBeenCalledWith("x");
});

it("shows formatted JSON in json mode when content is valid", () => {
  render(
    <NodeContentPanel
      value='{"a":1}'
      viewMode="json"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toContain('"a": 1');
});

it("shows parse error when JSON is invalid in json mode", () => {
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByText(/转换失败/)).toBeInTheDocument();
  expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
});

it("shows raw textarea in json edit mode regardless of content validity", () => {
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveValue("not json");
});

it("shows fallback button on parse error in view mode and calls onFallbackToRaw", async () => {
  const user = userEvent.setup();
  const onFallbackToRaw = vi.fn();
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={onFallbackToRaw}
    />
  );
  expect(screen.getByRole("button", { name: "切换到 Raw" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "切换到 Raw" }));
  expect(onFallbackToRaw).toHaveBeenCalledOnce();
});

it("shows formatted XML in xml mode when content is valid", () => {
  render(
    <NodeContentPanel
      value="<root><child>text</child></root>"
      viewMode="xml"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toContain("<root>");
  expect(textarea.value).toContain("<child>");
});

it("shows parse error when XML is invalid in xml mode", () => {
  render(
    <NodeContentPanel
      value="not xml <unclosed"
      viewMode="xml"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByText(/转换失败/)).toBeInTheDocument();
  expect(screen.getByText(/不是合法 XML/)).toBeInTheDocument();
});

it("shows raw textarea in xml edit mode regardless of content validity", () => {
  render(
    <NodeContentPanel
      value="<unclosed"
      viewMode="xml"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveValue("<unclosed");
});

it("shows plugin output in plugin mode", () => {
  render(
    <NodeContentPanel
      value="raw"
      pluginContent="decoded output"
      viewMode="plugin"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );

  expect(screen.getByRole("textbox")).toHaveValue("decoded output");
});
