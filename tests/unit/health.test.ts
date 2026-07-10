import { describe, expect, it } from "vitest";

import { GET, prerender } from "../../src/pages/api/health";

describe("/api/health", () => {
  it("is a Worker route, not prerendered", () => {
    expect(prerender).toBe(false);
  });

  it("returns ok status with build metadata and no-store caching", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["version"]).toBe("test");
    expect(typeof body["builtAt"]).toBe("string");
  });
});
