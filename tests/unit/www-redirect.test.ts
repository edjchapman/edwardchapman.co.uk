import { describe, expect, it } from "vitest";

import worker from "../../workers/www-redirect/index.js";

function respond(url: string): Response {
  return worker.fetch(new Request(url));
}

describe("www-redirect worker", () => {
  it("301s www on the canonical zone to the apex, preserving path and query", () => {
    const response = respond("https://www.edwardchapman.co.uk/notes?tag=ai");

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://edwardchapman.co.uk/notes?tag=ai",
    );
  });

  it("301s the alias apex and www hosts", () => {
    for (const host of ["edchapman.co.uk", "www.edchapman.co.uk"]) {
      const response = respond(`https://${host}/projects/foreman`);

      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(
        "https://edwardchapman.co.uk/projects/foreman",
      );
    }
  });

  it("410s the retired EC Docs sections on www, bare and nested", () => {
    for (const path of [
      "/code_quality",
      "/code_quality/editorconfig",
      "/security/nmap",
      "/system_admin/xen_orchestra",
    ]) {
      const response = respond(`https://www.edwardchapman.co.uk${path}`);

      expect(response.status).toBe(410);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=86400",
      );
    }
  });

  it("does not 410 lookalike paths or retired sections on the alias domain", () => {
    // Shares a prefix string with /security but is not the retired section.
    const lookalike = respond(
      "https://www.edwardchapman.co.uk/security-policy",
    );
    expect(lookalike.status).toBe(301);

    const alias = respond("https://edchapman.co.uk/security/nmap");
    expect(alias.status).toBe(301);
    expect(alias.headers.get("location")).toBe(
      "https://edwardchapman.co.uk/security/nmap",
    );
  });
});
