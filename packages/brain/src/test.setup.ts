// Vitest setup file (registered in vitest.config.ts). Fails any test that
// calls global `fetch`, and any non-adapter test that reads GEMINI_API_KEY or
// GEMINI_MODEL. See test.guard.ts.
import { afterAll, afterEach, beforeEach } from 'vitest';
import { blockingViolations, installGuards, takeViolations } from './test.guard.js';

installGuards();

let currentFile = '';

function failOnViolations(filePath: string): void {
  const blocking = blockingViolations(takeViolations(), filePath);
  if (blocking.length > 0) {
    const details = blocking.map((v) => v.detail).join('; ');
    throw new Error(`Test guard violation (no network, no Gemini env reads): ${details}`);
  }
}

beforeEach((context) => {
  currentFile = context.task.file.filepath;
});

afterEach((context) => {
  failOnViolations(context.task.file.filepath);
});

afterAll(() => {
  failOnViolations(currentFile);
});
