import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "tertiary";

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  tertiary: styles.tertiary,
};

const classes = (variant: ButtonVariant) => `${styles.button} ${variantClass[variant]}`;

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
}

/** The three button kinds of the Brand document. There is no destructive (red) variant on purpose. */
export function Button({ variant = "primary", type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes(variant)} {...rest}>
      {children}
    </button>
  );
}

/** A navigation that looks like a button, for example "Back". It is a link, never a form submit. */
export function ButtonLink({
  href,
  variant = "tertiary",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={classes(variant)}>
      {children}
    </Link>
  );
}
