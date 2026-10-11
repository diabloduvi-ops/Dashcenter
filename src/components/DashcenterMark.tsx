import type { ImgHTMLAttributes } from "react";

interface DashcenterMarkProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "draggable" | "height" | "src" | "width"> {
  label?: string;
  size?: number;
}

export function DashcenterMark({ label = "", size = 24, ...props }: DashcenterMarkProps) {
  return (
    <img
      {...props}
      src="/assets/dashcenter-mark.svg"
      alt={label}
      width={size}
      height={size}
      draggable={false}
    />
  );
}
