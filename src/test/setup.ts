import "@testing-library/jest-dom";
import { vi } from "vitest";

// Expose jest as an alias for vi so that @testing-library/react's
// jestFakeTimersAreEnabled() check works correctly with Vitest fake timers.
// Without this, waitFor hangs when vi.useFakeTimers() is active because the
// asyncWrapper drain step calls jest.advanceTimersByTime(0) which is gated
// on typeof jest !== 'undefined'.
(globalThis as unknown as { jest: typeof vi }).jest = vi;
