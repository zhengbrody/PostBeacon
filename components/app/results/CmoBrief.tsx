"use client";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PLATFORMS } from "@/lib/platforms";
import { successContractSummary } from "@/lib/successContract";
import type { SuccessContract, TrialResearchInput } from "@/lib/types";

/** The editable Brief is ephemeral input, not a second plan or task ledger. */
export function CmoBrief({
  input,
  contract,
  onChange,
}: {
  input: TrialResearchInput;
  contract: SuccessContract;
  onChange: (patch: Partial<TrialResearchInput>) => void;
}) {
  const productLed = input.mode === "product-led";
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3">
        <p className="text-xs font-medium text-accent-300">Your existing experiment goal</p>
        <p className="mt-1 text-sm">{contract.primaryGoal}</p>
        <p className="mt-1 text-xs text-neutral-400">{successContractSummary(contract)}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Inherited from Launch setup. This Brief does not change your success definition.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="1. Who should try this?"
          value={input.audience}
          onChange={(audience) => onChange({ audience })}
          placeholder="One specific type of person"
        />
        <Field
          label="2. One useful task to try"
          value={input.task}
          onChange={(task) => onChange({ task })}
          placeholder="One task your current product actually supports"
        />
      </div>
      <Field
        label="3. One question you want answered"
        value={input.feedbackQuestion}
        onChange={(feedbackQuestion) => onChange({ feedbackQuestion })}
        placeholder="What would help you improve the product?"
      />
      <p className="text-xs text-neutral-500">
        Editable starting points, not verified trial instructions. Your edits stay in this
        Brief until you submit a task; nothing is sent while you type.
      </p>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer py-1 text-sm text-neutral-300">
          Review delivery details & optional demand evidence
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label="Real product trial entry"
            value={input.entryUrl}
            onChange={(entryUrl) => onChange({ entryUrl })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-neutral-400">
              Publishing channel
              <select
                aria-label="Trial publishing channel"
                className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm"
                value={input.platformId}
                onChange={(e) => onChange({ platformId: e.target.value })}
              >
                {PLATFORMS.map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Publishing venue — not an evidence source"
              value={input.venue}
              onChange={(venue) => onChange({ venue })}
              placeholder="Your own profile, or the exact community"
            />
          </div>
          <p className="text-xs text-amber-300">
            Proposed steps: check and edit these against your actual product before using
            the kit. They are not server-verified functionality.
          </p>
          {input.steps.map((step, index) => (
            <Field
              key={index}
              label={`Trial step ${index + 1}`}
              value={step}
              onChange={(value) => {
                const steps: [string, string, string] = [...input.steps];
                steps[index] = value;
                onChange({ steps });
              }}
            />
          ))}
          <fieldset className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-xs text-neutral-400">
              What can this task claim?
            </legend>
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="radio"
                name="trial-brief-mode"
                checked={productLed}
                onChange={() => onChange({ mode: "product-led", sources: [] })}
              />
              <span>
                Use verified product facts
                <span className="mt-1 block text-xs text-neutral-400">
                  No demand source needed. Does not claim customers or demand were found.
                </span>
              </span>
            </label>
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="radio"
                name="trial-brief-mode"
                checked={!productLed}
                onChange={() =>
                  onChange({
                    mode: "evidence-led",
                    sources: input.sources.length
                      ? input.sources
                      : [{ url: "", quote: "", fetchAllowed: false }],
                  })
                }
              />
              <span>
                Add public demand evidence
                <span className="mt-1 block text-xs text-neutral-400">
                  Only your explicit sources. A quote is not permission to promote there.
                </span>
              </span>
            </label>
          </fieldset>
          {!productLed &&
            input.sources.map((source, index) => (
              <div key={index} className="space-y-3 rounded-lg border border-line p-3">
                <Field
                  label={`Demand source ${index + 1} URL`}
                  value={source.url}
                  onChange={(url) =>
                    onChange({
                      sources: input.sources.map((item, i) =>
                        i === index ? { ...item, url } : item
                      ),
                    })
                  }
                />
                <Field
                  label={`Demand excerpt ${index + 1} — 30–400 characters`}
                  textarea
                  value={source.quote}
                  onChange={(quote) =>
                    onChange({
                      sources: input.sources.map((item, i) =>
                        i === index ? { ...item, quote } : item
                      ),
                    })
                  }
                />
                <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={source.fetchAllowed}
                    onChange={(event) =>
                      onChange({
                        sources: input.sources.map((item, i) =>
                          i === index
                            ? { ...item, fetchAllowed: event.target.checked }
                            : item
                        ),
                      })
                    }
                  />
                  I have permission for this public page to be fetched. Check only this URL.
                </label>
                <p className="text-xs text-neutral-500">
                  Default: excerpt only. X, Reddit and restricted social sites require
                  reviewed connectors; leave fetching unchecked.
                </p>
                {input.sources.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() =>
                      onChange({ sources: input.sources.filter((_, i) => i !== index) })
                    }
                  >
                    Remove source {index + 1}
                  </Button>
                )}
              </div>
            ))}
          {!productLed && input.sources.length < 3 && (
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() =>
                onChange({
                  sources: [...input.sources, { url: "", quote: "", fetchAllowed: false }],
                })
              }
            >
              Add another source
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}
