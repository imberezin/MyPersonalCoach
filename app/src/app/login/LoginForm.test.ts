// The sign-in form as markup, with the real catalogs: the words, the roles, and the state the password field starts in.
// What a press does (flip the field) needs a browser; the rule it follows is `passwordFieldState`, tested here as a pure function.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { LoginForm } from "./LoginForm";
import { passwordFieldState } from "./passwordField";

// The server action reaches for cookies and the database; the form only needs to hand it to the browser.
vi.mock("./actions", () => ({ signIn: vi.fn() }));

const catalogs = { he, en } as const;
const LOCALES = ["he", "en"] as const;

function render(locale: (typeof LOCALES)[number]): string {
  const props = { locale, messages: catalogs[locale] as AbstractIntlMessages, timeZone: "UTC" } as ComponentProps<typeof IntlProvider>;
  return renderToStaticMarkup(createElement(IntlProvider, props, createElement(LoginForm)));
}

describe("passwordFieldState", () => {
  it("hides the password and offers to show it", () => {
    expect(passwordFieldState(false)).toEqual({ inputType: "password", labelKey: "showPassword" });
  });

  it("shows the password and offers to hide it", () => {
    expect(passwordFieldState(true)).toEqual({ inputType: "text", labelKey: "hidePassword" });
  });
});

describe.each(LOCALES)("LoginForm password field in %s", (locale) => {
  const words = catalogs[locale].auth;
  const html = render(locale);
  const input = html.match(/<input\b[^>]*name="password"[^>]*>/)?.[0] ?? "";
  const button = html.match(/<button\b[^>]*aria-controls="[^"]*"[^>]*>/)?.[0] ?? "";

  it("starts hidden, and keeps the browser's own password help", () => {
    expect(input).toContain('type="password"');
    expect(input).toContain('autoComplete="current-password"');
    expect(input).toContain("required");
  });

  it("is named by a label that points at the input", () => {
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>${words.password}</label>`));
  });

  it("has a real button, outside the label, that names what a press does and points at the input", () => {
    expect(button).toContain('type="button"');
    expect(button).toContain(`aria-label="${words.showPassword}"`);
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(input).toContain(`id="${controls}"`);
    // The button is never inside the label of the field it controls.
    expect(html).not.toMatch(/<label[^>]*>(?:(?!<\/label>)[^])*<button/);
  });

  it("draws the icon for assistive technology as nothing: the button's own name says it", () => {
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain("<title");
  });

  it("does not paint the crossed-out eye until the password is shown", () => {
    // Hidden at first: the plain eye, no diagonal stroke.
    expect(html).not.toContain("M4 4l16 16");
  });

  it("keeps the email field and the submit button as they were", () => {
    expect(html).toMatch(/<input\b[^>]*name="email"[^>]*type="email"|<input\b[^>]*type="email"[^>]*name="email"/);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${words.submit}</button>`));
  });
});
