import { IBM_Plex_Sans_Hebrew } from "next/font/google";

/**
 * The light cuts are what let a figure stand very large and stay quiet, and the repo's self-hosted Plex stops at 400.
 * next/font self-hosts these at build time, so nothing is fetched from Google by a visitor. No preload: the other
 * styles never use them.
 */
const plex = IBM_Plex_Sans_Hebrew({ weight: ["200", "300", "400", "500", "600"], subsets: ["hebrew", "latin"], display: "swap", preload: false, variable: "--mh-plex" });

/** On <html>, so what portals to the body reads it too. The login stands outside the shell, so this can't wait for it. */
if (typeof document !== "undefined") document.documentElement.classList.add(plex.variable);
