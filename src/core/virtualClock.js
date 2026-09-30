// A controllable clock for TESTING the scheduler without waiting for real
// time: replaces the global Date so that `new Date()` and `Date.now()` return
// (real time + an offset). With offset 0 it is indistinguishable from the real
// Date. Dates built from arguments (`new Date("2026-03-14")`) are untouched.
//
// Only electron/testHarness.js installs it, and only in explicit test mode
// (see isTestModeEnabled). It must never be active in normal use: an app that
// sends messages on a schedule must run on the real clock.

/** Test mode needs BOTH switches, so a stray variable can't turn it on in a normal install. */
export function isTestModeEnabled(env = process.env) {
  return env.BIRTHDAY_BOT_TEST_CLOCK === "1" && Boolean(env.BIRTHDAY_BOT_USER_DATA);
}

/**
 * @param {DateConstructor} RealDate
 * @returns {{ VirtualDate: DateConstructor, getOffsetMs: () => number, setOffsetMs: (ms: number) => void,
 *             setNow: (when: Date|string|number) => void, advance: (ms: number) => void, reset: () => void }}
 */
export function createVirtualClock(RealDate = Date) {
  let offsetMs = 0;

  const VirtualDate = new Proxy(RealDate, {
    // new Date() -> shifted "now"; new Date(x, ...) -> exactly what was asked for.
    construct(target, args, newTarget) {
      if (args.length === 0) return new target(RealDate.now() + offsetMs);
      return Reflect.construct(target, args, newTarget === VirtualDate ? target : newTarget);
    },
    get(target, prop, receiver) {
      if (prop === "now") return () => RealDate.now() + offsetMs;
      return Reflect.get(target, prop, receiver);
    },
    // Date() called as a function returns a string for "now".
    apply(target) {
      return new RealDate(RealDate.now() + offsetMs).toString();
    },
  });

  return {
    VirtualDate,
    getOffsetMs: () => offsetMs,
    setOffsetMs: (ms) => {
      offsetMs = Number(ms) || 0;
    },
    /** Make "now" equal `when` (it keeps ticking forward in real time from there). */
    setNow(when) {
      const target = new RealDate(when).getTime();
      if (Number.isNaN(target)) throw new Error(`virtual clock: not a valid time: ${when}`);
      offsetMs = target - RealDate.now();
    },
    advance(ms) {
      offsetMs += Number(ms) || 0;
    },
    reset() {
      offsetMs = 0;
    },
  };
}
