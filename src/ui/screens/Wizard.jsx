import React, { useState } from "react";
import ConsentStep from "./wizard/ConsentStep.jsx";
import PairStep from "./wizard/PairStep.jsx";
import ImportStep from "./wizard/ImportStep.jsx";
import ScheduleStep from "./wizard/ScheduleStep.jsx";
import DoneStep from "./wizard/DoneStep.jsx";

const STEPS = ["consent", "pair", "import", "schedule", "done"];

export default function Wizard({ settings, waState, onComplete, onSettingsChange }) {
  // Skip straight past a step that's already satisfied (e.g. re-opening the
  // wizard from Settings when WhatsApp is already paired).
  const initialIndex = (() => {
    if (!settings?.riskAcknowledged) return 0;
    if (waState?.status !== "ready") return 1;
    return 2;
  })();
  const [stepIndex, setStepIndex] = useState(initialIndex);
  const step = STEPS[stepIndex];

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));

  return (
    <div className="wizard-shell">
      <div className="wizard-box">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i <= stepIndex ? "done" : ""}`} />
          ))}
        </div>
        <div className="card">
          {step === "consent" && (
            <ConsentStep
              onAccept={async () => {
                await window.api.settings.set("riskAcknowledged", true);
                await onSettingsChange();
                next();
              }}
            />
          )}
          {step === "pair" && <PairStep waState={waState} onPaired={next} />}
          {step === "import" && <ImportStep onDone={next} />}
          {step === "schedule" && (
            <ScheduleStep
              settings={settings}
              onSaved={async () => {
                await onSettingsChange();
                next();
              }}
            />
          )}
          {step === "done" && <DoneStep onFinish={onComplete} />}
        </div>
      </div>
    </div>
  );
}
