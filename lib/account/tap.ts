/**
 * Safari opens a passkey prompt only from a tap. It lets one request through without a tap per page load,
 * and a successful passkey use spends that allowance. So a second prompt that follows the first on its own
 * (opening an account on a new device), or one that waits on the network after the tap, can be refused.
 *
 * When that happens, the request waits here. The tap prompt shows a button, and the request runs again
 * from that tap, which Safari always allows.
 */
export type TapRequest = { start: () => void; cancel: () => void };

let current: TapRequest | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const tapRequests = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  current: () => current,
};

/**
 * Runs `request` from the person's next tap on the prompt. `start` must be called inside the tap's handler:
 * it calls `request` before returning, so the browser still counts the tap.
 */
export function afterTap<T>(request: () => Promise<T>, cancelled: () => unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    current?.cancel();
    const settle = () => {
      if (current !== waiting) return false;
      current = null;
      changed();
      return true;
    };
    const waiting: TapRequest = {
      start: () => {
        if (settle()) request().then(resolve, reject);
      },
      cancel: () => {
        if (settle()) reject(cancelled());
      },
    };
    current = waiting;
    changed();
  });
}
