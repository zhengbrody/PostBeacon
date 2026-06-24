import { ComponentProps } from "react";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface/60 ${className ?? ""}`}
      {...props}
    />
  );
}
