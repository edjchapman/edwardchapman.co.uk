import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  scanText,
  type PolicyConfig,
} from "../../scripts/check-content-policy";

const config: PolicyConfig = JSON.parse(
  readFileSync(
    join(process.cwd(), "scripts/content-policy-rules.json"),
    "utf8",
  ),
);

const ids = (violations: { ruleId: string }[]) =>
  violations.map((v) => v.ruleId);

describe("content-policy scanner", () => {
  it("flags references to the private career-portfolio repo in shipped trees", () => {
    const hits = scanText(
      "src/content/profile/positioning.md",
      "See my career-portfolio for details.",
      config,
    );
    expect(ids(hits)).toContain("private-repo-reference");
  });

  it("does not apply the private-repo rule to docs (policy may name it)", () => {
    const hits = scanText(
      "docs/content-policy.md",
      "The private career-portfolio repository is prohibited.",
      config,
    );
    expect(ids(hits)).not.toContain("private-repo-reference");
  });

  it("flags UK mobile numbers", () => {
    const hits = scanText(
      "src/pages/index.astro",
      "Call me on 07123 456 789.",
      config,
    );
    expect(ids(hits)).toContain("uk-phone");
  });

  it("flags full UK postcodes in content", () => {
    const hits = scanText(
      "src/content/profile/positioning.md",
      "Based at SW1A 1AA, London.",
      config,
    );
    expect(ids(hits)).toContain("full-uk-postcode");
  });

  it("flags salary figures", () => {
    const hits = scanText(
      "src/content/profile/positioning.md",
      "Currently on £85,000 and looking for 95k per year.",
      config,
    );
    expect(ids(hits)).toContain("salary-figures");
  });

  it("fails closed on emails: only the approved address is allowed", () => {
    const disallowed = scanText(
      "src/pages/index.astro",
      "Email edchapman88@gmail.com for details.",
      config,
    );
    expect(ids(disallowed)).toContain("email-address");

    const allowed = scanText(
      "src/pages/index.astro",
      'href="mailto:ed@edwardchapman.co.uk"',
      config,
    );
    expect(ids(allowed)).not.toContain("email-address");
  });

  it("honours the line-level allow marker", () => {
    const hits = scanText(
      "src/content/notes/example.md",
      "Ring 07123 456 789 <!-- content-policy-allow:uk-phone -->",
      config,
    );
    expect(ids(hits)).not.toContain("uk-phone");
  });

  it("keeps the noncanonical-origin rule disabled until cutover", () => {
    const hits = scanText(
      "dist/index.html",
      'href="https://edwardchapman.workers.dev/x"',
      config,
    );
    expect(ids(hits)).not.toContain("noncanonical-origin");
  });
});
