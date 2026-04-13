import { describe, expect, it } from "vitest";
import { validateEngine3CaseGroups } from "@/lib/engine3CaseGroupsValidate";

describe("validateEngine3CaseGroups", () => {
  it("accepts a full partition", () => {
    expect(validateEngine3CaseGroups(3, [[0, 2], [1]])).toEqual([[0, 2], [1]]);
  });

  it("rejects overlap", () => {
    expect(validateEngine3CaseGroups(2, [[0, 1], [1]])).toBeNull();
  });

  it("rejects missing index", () => {
    expect(validateEngine3CaseGroups(2, [[0]])).toBeNull();
  });

  it("rejects out of range", () => {
    expect(validateEngine3CaseGroups(1, [[2]])).toBeNull();
  });
});
