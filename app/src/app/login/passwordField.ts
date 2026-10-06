/**
 * What the password field is while it is hidden or readable: the input's type, and the words of the button that flips it
 * (the button always names what a press will do). Pure, so the rule is tested without a browser.
 */
export type PasswordFieldState =
  | { inputType: "password"; labelKey: "showPassword" }
  | { inputType: "text"; labelKey: "hidePassword" };

export function passwordFieldState(revealed: boolean): PasswordFieldState {
  return revealed ? { inputType: "text", labelKey: "hidePassword" } : { inputType: "password", labelKey: "showPassword" };
}
