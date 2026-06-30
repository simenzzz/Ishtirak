import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{
    variant?: Variant;
    block?: boolean;
    children: ReactNode;
  }>;

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn btn--primary",
  ghost: "btn btn--ghost",
  danger: "btn btn--danger",
};

export function Button({ variant = "primary", block = false, className, children, ...rest }: Props) {
  const classes = [VARIANT_CLASS[variant], block ? "btn--block" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
