import { useState, useCallback, useEffect, useRef } from "react";

export function usePanelResize(
  defaultWidth: number,
  storageKey: string,
  min = 160,
  max = 400
) {
  const stored = localStorage.getItem(storageKey);
  const initial = stored ? Math.min(max, Math.max(min, parseInt(stored, 10))) : defaultWidth;
  const [width, setWidthRaw] = useState(initial);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const setWidth = useCallback((w: number) => {
    const clamped = Math.min(max, Math.max(min, w));
    setWidthRaw(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }, [storageKey, min, max]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(startWidth.current + (e.clientX - startX.current));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  return { width, setWidth, onMouseDown };
}
