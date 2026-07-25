export async function withFinallyCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await cleanup();
  }
}
