/** Site-wide constants. The single place origin and identity live. */

export const SITE = {
  name: "Ed Chapman",
  /** Formal name (matches the domain). Displayed as `name` everywhere; this
   * appears only as an `alternateName` in structured data, to help search
   * engines reconcile "Ed" and "Edward Chapman" as one entity. */
  fullName: "Edward Chapman",
  /** Homepage title. Deliberately prefix-form ("Ed Chapman — role") so the
   * name leads its SERP entry; every other page is suffix-form
   * ("Page — Ed Chapman"). Both patterns are pinned by metadata.spec. */
  title: "Ed Chapman — Senior Software & Platform Engineer",
  description:
    "Ed Chapman, senior software and platform engineer in London: backend depth in Python/Django, infrastructure ownership on AWS and Terraform, React/TypeScript product work, and evaluation-driven AI engineering.",
  origin: "https://edwardchapman.co.uk",
  github: "https://github.com/edjchapman",
  linkedin: "https://www.linkedin.com/in/edjchapman/",
  x: "https://x.com/edjchapman",
  /** X/Twitter @handle for card attribution (twitter:site/creator). */
  xHandle: "@edjchapman",
  email: "ed@edwardchapman.co.uk",
  repo: "https://github.com/edjchapman/edwardchapman.co.uk",
} as const;
