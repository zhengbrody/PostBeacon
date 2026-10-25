import { describe, expect, it } from "vitest";
import { createAsyncScope, createSerialQueue, StaleRequestError } from "@/lib/asyncScope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("async account/project response boundaries", () => {
  it("aborts and rejects late responses after an identity reset, even on A → B → A", () => {
    const scope = createAsyncScope();
    const first = scope.capture();
    scope.invalidate();
    scope.invalidate();
    expect(first.signal.aborted).toBe(true);
    expect(() => first.check()).toThrow(StaleRequestError);
    expect(scope.capture().current()).toBe(true);
  });
  it("a newer request owns completion; old errors cannot affect the new request", async () => {
    const scope = createAsyncScope();
    const gate = deferred<void>();
    let applied = false;
    const old = scope.begin();
    const pending = (async () => {
      await gate.promise;
      old.check();
      applied = true;
    })();
    const current = scope.begin();
    gate.resolve();
    await expect(pending).rejects.toBeInstanceOf(StaleRequestError);
    expect(applied).toBe(false);
    expect(current.current()).toBe(true);
  });
  it("rejects edited context without invalidating an unrelated request", () => {
    const scope = createAsyncScope();
    let revision = 1;
    const first = scope.capture(() => revision === 1);
    revision = 2;
    expect(() => first.check()).toThrow(StaleRequestError);
    const second = scope.capture(() => revision === 2);
    first.release();
    expect(second.current()).toBe(true);
  });
  it("does not confuse releasing a ticket with invalidating the current scope", () => {
    const scope = createAsyncScope();
    const ticket = scope.capture();
    ticket.release();
    expect(ticket.current()).toBe(true);
    scope.invalidate();
    expect(ticket.current()).toBe(false);
  });
});

describe("ordered client saves", () => {
  it("does not block an unrelated owner/project behind an old pending write", async () => {
    const queue = createSerialQueue();
    const gate = deferred<void>();
    let nextWritten = false;
    const old = queue.enqueue(async () => gate.promise, "A:project-1");
    await queue.enqueue(async () => {
      nextWritten = true;
    }, "B:project-2");
    expect(nextWritten).toBe(true);
    gate.resolve();
    await old;
  });
  it("does not start the newer save until the older write and mirror finish", async () => {
    const queue = createSerialQueue();
    const gate = deferred<void>();
    const writes: string[] = [];
    const first = queue.enqueue(async () => {
      writes.push("old-start");
      await gate.promise;
      writes.push("old-mirror");
      return true;
    });
    const second = queue.enqueue(async () => {
      writes.push("new-write");
      return true;
    });
    await Promise.resolve();
    expect(writes).toEqual(["old-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(writes).toEqual(["old-start", "old-mirror", "new-write"]);
  });
  it("a failed write does not poison the queue", async () => {
    const queue = createSerialQueue();
    const first = queue.enqueue(async () => {
      throw new Error("failed");
    });
    const second = queue.enqueue(async () => "saved");
    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe("saved");
  });
  it("queued stale-account work cannot write after a boundary change", async () => {
    const queue = createSerialQueue();
    const scope = createAsyncScope();
    const gate = deferred<void>();
    const blocker = queue.enqueue(async () => gate.promise);
    const ticket = scope.capture();
    let writes = 0;
    const old = queue.enqueue(async () => {
      if (!ticket.current()) return false;
      writes += 1;
      return true;
    });
    scope.invalidate();
    gate.resolve();
    await blocker;
    expect(await old).toBe(false);
    expect(writes).toBe(0);
  });
});
