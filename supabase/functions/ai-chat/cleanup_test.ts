import { withFinallyCleanup } from "./cleanup.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("finally cleanup runs after a successful provider result", async () => {
  let cleanupCalls = 0;
  const result = await withFinallyCleanup(
    () => Promise.resolve("ok"),
    () => {
      cleanupCalls += 1;
      return Promise.resolve();
    },
  );

  assertEquals(result, "ok");
  assertEquals(cleanupCalls, 1);
});

Deno.test("finally cleanup runs after a handled provider error", async () => {
  let cleanupCalls = 0;
  const result = await withFinallyCleanup(
    () => Promise.resolve("PROVIDER_UNAVAILABLE"),
    () => {
      cleanupCalls += 1;
      return Promise.resolve();
    },
  );

  assertEquals(result, "PROVIDER_UNAVAILABLE");
  assertEquals(cleanupCalls, 1);
});

Deno.test("finally cleanup runs when provider timeout aborts", async () => {
  let cleanupCalls = 0;
  let errorName = "";

  try {
    await withFinallyCleanup(
      () => Promise.reject(new DOMException("timed out", "AbortError")),
      () => {
        cleanupCalls += 1;
        return Promise.resolve();
      },
    );
  } catch (error) {
    errorName = error instanceof DOMException ? error.name : "unexpected";
  }

  assertEquals(errorName, "AbortError");
  assertEquals(cleanupCalls, 1);
});
