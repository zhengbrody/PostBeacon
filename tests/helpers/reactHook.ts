import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

/** Actual React effects/rendering in jsdom, no hand-rolled Hook implementation. */
export async function mountHook<P, T>(hook: (props: P) => T, props: P) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let value: T;
  function Probe({ input }: { input: P }) {
    value = hook(input);
    return null;
  }
  await act(async () => {
    root.render(createElement(Probe, { input: props }));
  });
  return {
    get current() {
      return value;
    },
    async render(next: P) {
      await act(async () => {
        root.render(createElement(Probe, { input: next }));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
