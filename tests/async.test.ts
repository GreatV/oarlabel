import { describe, expect, it } from "vitest";
import { mapLimited } from "@/lib/async";

describe("mapLimited", () => {
  it("makes interrupted result holes explicit", async () => {
    let continued = true;
    const result = await mapLimited(
      [1, 2, 3],
      1,
      async (value) => {
        continued = false;
        return value * 2;
      },
      () => continued,
    );

    expect(result).toEqual([2, undefined, undefined]);
    expect(result.filter((item) => item != null)).toEqual([2]);
  });
});
