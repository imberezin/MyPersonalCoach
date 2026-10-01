"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/ui/Button";

/** A submit button that turns itself off and changes its label while its form's action is running (a double tap saves once). */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
