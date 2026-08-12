/**
 * The ask form's example questions, in a React-free module so both the
 * island and the page's pre-hydration skeleton can read them. Importing
 * them from AskForm.tsx instead would pull React into the server module
 * graph, which `client:only` exists to prevent (ADR-0004).
 *
 * Golden-fixture phrasings where one exists (retrieval is pinned to answer
 * them); the career and education questions use their goldens' verbatim
 * wording. tests/agent/baseline.test.ts asserts each one has a reviewed
 * baseline answer (ADR-0027).
 */
export const EXAMPLE_QUESTIONS = [
  "What kind of engineering roles is Ed best suited to?",
  "Where has Ed worked, and when?",
  "Is Ed open to contract or permanent roles?",
  "What is Ed's educational background?",
  "How did Foreman handle reliable event processing?",
  "What does Ed mean by evaluation-driven AI engineering?",
];
