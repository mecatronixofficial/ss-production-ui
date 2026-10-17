"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** The numbered steps across the top of the start wizard; a step already passed can be tapped to go back to it. */
export function WizardSteps({ steps, current, onJump }: { steps: string[]; current: number; onJump: (step: number) => void }) {
  return (
    <ol className="start-wizard__steps" aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className={cn(i < current && "is-done", i === current && "is-now")}>
          <button type="button" disabled={i >= current} onClick={() => onJump(i)} aria-current={i === current ? "step" : undefined}>
            <span className="start-wizard__num">{i < current ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            <span className="start-wizard__label">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Back and next under a step; on the last step "next" is the start button. `hint` says what is still missing. */
export function WizardNav({
  onBack,
  onNext,
  nextLabel = "Next",
  nextIcon,
  disabled = false,
  hint,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextIcon?: React.ReactNode;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <div className="start-wizard__nav">
      <p className="start-wizard__hint">{hint}</p>
      <div className="flex shrink-0 gap-2">
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </Button>
        )}
        <Button disabled={disabled} onClick={onNext}>
          {nextLabel} {nextIcon ?? <ArrowRight size={15} />}
        </Button>
      </div>
    </div>
  );
}

/** The confirm step's read-back: every choice made, grouped, before anything is saved. */
export function WizardSummary({ groups }: { groups: Array<{ title: string; rows: Array<[string, React.ReactNode]> }> }) {
  return (
    <div className="start-wizard__summary">
      {groups.map((group) => (
        <section key={group.title}>
          <h4>{group.title}</h4>
          <dl>
            {group.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
