"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { scheduleDate } from "@/lib/dates";
import { PrintHeading } from "./PrintHeading";
import type { ScheduleItem } from "@/lib/types";

/** The launch calendar: date picker, editable rows, add-your-own step. */
export function CalendarTab({
  schedule,
  launchDate,
  setLaunchDate,
  printing,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
}: {
  schedule: ScheduleItem[];
  launchDate: string;
  setLaunchDate: (v: string) => void;
  printing: boolean;
  onUpdateItem: (idx: number, patch: Partial<ScheduleItem>) => void;
  onRemoveItem: (idx: number) => void;
  onAddItem: (item: ScheduleItem) => void;
}) {
  return (
    <section>
      {printing && <PrintHeading>Calendar</PrintHeading>}
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">📅 Launch calendar</h2>
          <label className="no-print flex items-center gap-2 text-xs text-neutral-400">
            Launch day
            <input
              type="date"
              value={launchDate}
              onChange={(e) => setLaunchDate(e.target.value)}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>
        </div>
        <ol className="relative space-y-2 border-l border-line pl-5">
          {schedule.map((s, i) => (
            <CalendarRow
              key={`${s.day}-${s.action}-${i}`}
              item={s}
              date={scheduleDate(launchDate, s.day)}
              onCommit={(patch) => onUpdateItem(i, patch)}
              onDelete={() => onRemoveItem(i)}
            />
          ))}
        </ol>
        <AddStepRow onAdd={onAddItem} />
      </Card>
    </section>
  );
}

/** One calendar step. Edits are drafted locally and committed on Done, so the
 *  by-day re-sort never yanks the row out from under the cursor. */
function CalendarRow({
  item,
  date,
  onCommit,
  onDelete,
}: {
  item: ScheduleItem;
  date: string;
  onCommit: (patch: Partial<ScheduleItem>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(String(item.day));
  const [action, setAction] = useState(item.action);

  const commit = () => {
    onCommit({
      day: Math.max(1, Number(day) || item.day),
      action: action.trim() || item.action,
    });
    setEditing(false);
  };

  return (
    <li className="relative">
      <span className="absolute -left-[1.42rem] top-2 h-2 w-2 rounded-full bg-accent-500" />
      {editing ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
          <label className="text-xs text-neutral-400">
            Day
            <input
              type="number"
              min={1}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1 block w-16 rounded-md border border-line bg-surface px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>
          <Field
            label="Action"
            value={action}
            onChange={setAction}
            className="min-w-0 flex-1"
          />
          <Button size="sm" onClick={commit}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
          <span className="shrink-0 rounded-md bg-accent-700/40 px-2 py-1 text-xs font-medium text-accent-200">
            Day {item.day}
            {date && <span className="ml-1 text-accent-300/80">· {date}</span>}
          </span>
          <span className="min-w-0 flex-1 text-neutral-300">{item.action}</span>
          <span className="no-print flex shrink-0 gap-1 text-xs">
            <button
              onClick={() => {
                setDay(String(item.day));
                setAction(item.action);
                setEditing(true);
              }}
              className="text-neutral-500 hover:text-neutral-200"
            >
              ✎
            </button>
            <button onClick={onDelete} className="text-neutral-600 hover:text-red-400">
              ×
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function AddStepRow({ onAdd }: { onAdd: (item: ScheduleItem) => void }) {
  const [day, setDay] = useState("1");
  const [action, setAction] = useState("");
  return (
    <div className="no-print mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
      <label className="text-xs text-neutral-400">
        Day
        <input
          type="number"
          min={1}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 block w-16 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
        />
      </label>
      <Field
        label="Add your own step"
        value={action}
        onChange={setAction}
        placeholder="e.g. Email 10 beta users for feedback"
        className="min-w-0 flex-1"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!action.trim()}
        onClick={() => {
          onAdd({
            day: Math.max(1, Number(day) || 1),
            platformId: "custom",
            platformName: "Custom",
            action: action.trim(),
          });
          setAction("");
        }}
      >
        ＋ Add step
      </Button>
    </div>
  );
}
