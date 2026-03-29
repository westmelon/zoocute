import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ReactNode } from "react";

const OPTIONS = {
  scrollbars: {
    theme: "os-theme-dark",
    autoHide: "scroll" as const,
    autoHideDelay: 800,
  },
} as const;

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export function ScrollArea({ children, className }: ScrollAreaProps) {
  return (
    <OverlayScrollbarsComponent element="div" className={className} options={OPTIONS} defer>
      {children}
    </OverlayScrollbarsComponent>
  );
}
