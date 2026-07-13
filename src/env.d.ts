/// <reference types="astro/client" />

// Injected at build time via astro.config.ts `vite.define`.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

// Workers runtime module — resolvable only inside workerd (deploy and
// `wrangler dev`); callers must handle the Node import failure.
declare module "cloudflare:workers" {
  export const env: unknown;
}
