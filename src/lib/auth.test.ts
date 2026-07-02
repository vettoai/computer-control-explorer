import { describe, expect, it } from "vitest";

import {
  authTokenFor,
  isValidAuthCookie,
  passwordMatches,
  safeRedirectPath,
} from "./auth";

describe("authTokenFor", () => {
  it("is deterministic and never the raw password", () => {
    const token = authTokenFor("hunter2");
    expect(token).toBe(authTokenFor("hunter2"));
    expect(token).not.toContain("hunter2");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across passwords", () => {
    expect(authTokenFor("a")).not.toBe(authTokenFor("b"));
  });
});

describe("isValidAuthCookie", () => {
  it("accepts the token derived from the password", () => {
    expect(isValidAuthCookie(authTokenFor("s3cret"), "s3cret")).toBe(true);
  });

  it("rejects tokens for other passwords, garbage, and the raw password", () => {
    expect(isValidAuthCookie(authTokenFor("other"), "s3cret")).toBe(false);
    expect(isValidAuthCookie("not-a-token", "s3cret")).toBe(false);
    expect(isValidAuthCookie("s3cret", "s3cret")).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("s3cret", "s3cret")).toBe(true);
    expect(passwordMatches("s3cret ", "s3cret")).toBe(false);
    expect(passwordMatches("", "s3cret")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-origin absolute paths", () => {
    expect(safeRedirectPath("/task/foo")).toBe("/task/foo");
    expect(safeRedirectPath("/task/foo?tab=trials")).toBe("/task/foo?tab=trials");
  });

  it("falls back to / for anything else", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath("https://evil.example")).toBe("/");
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("task/foo")).toBe("/");
    expect(safeRedirectPath(42)).toBe("/");
  });
});
