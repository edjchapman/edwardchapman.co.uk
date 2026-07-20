/** Site-wide constants. The single place origin and identity live. */

export const SITE = {
  name: "Ed Chapman",
  /** Formal name (matches the domain). Displayed as `name` everywhere; this
   * appears only as an `alternateName` in structured data, to help search
   * engines reconcile "Ed" and "Edward Chapman" as one entity. */
  fullName: "Edward Chapman",
  title: "Ed Chapman — Senior Software Engineer",
  description:
    "Ed Chapman, senior software engineer in London: backend and platform depth in Python/Django, infrastructure ownership on AWS, React/TypeScript product work, and evaluation-driven AI engineering.",
  origin: "https://edwardchapman.co.uk",
  github: "https://github.com/edjchapman",
  linkedin: "https://www.linkedin.com/in/edjchapman/",
  x: "https://x.com/edjchapman",
  /** X/Twitter @handle for card attribution (twitter:site/creator). */
  xHandle: "@edjchapman",
  email: "ed@edwardchapman.co.uk",
  repo: "https://github.com/edjchapman/edwardchapman.co.uk",
} as const;
