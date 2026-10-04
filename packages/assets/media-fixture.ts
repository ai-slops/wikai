import { readFile } from "node:fs/promises";

export const mediaFixture = (name: "tone.mp3" | "tone.wav" | "tone.mp4" | "tone.webm") =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url));
