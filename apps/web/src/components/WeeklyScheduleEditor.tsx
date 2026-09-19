import React from 'react';
import { WeeklyScheduleEntry, WeekDay } from '../api/doctor.api';
import { DAY_LABELS } from '../utils/weeklySchedule';

interface WeeklyScheduleEditorProps {
  value: WeeklyScheduleEntry[];
  onChange: (next: WeeklyScheduleEntry[]) => void;
}

export const WeeklyScheduleEditor: React.FC<WeeklyScheduleEditorProps> = ({ value, onChange }) => {
  const update = (day: WeekDay, patch: Partial<WeeklyScheduleEntry>) => {
    onChange(value.map((e) => (e.day === day ? { ...e, ...patch } : e)));
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-[var(--color-text-secondary)]">Weekly Schedule</label>
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        {value.map((entry) => (
          <div
            key={entry.day}
            className="flex items-center gap-3 px-3 py-2 border-b border-[var(--color-border)] last:border-0 text-sm"
          >
            <label className="flex items-center gap-2 w-32 flex-shrink-0">
              <input
                type="checkbox"
                checked={entry.available}
                onChange={(e) => update(entry.day, { available: e.target.checked })}
              />
              <span className="font-medium text-[var(--color-text-primary)]">{DAY_LABELS[entry.day]}</span>
            </label>
            <input
              type="time"
              value={entry.startTime}
              onChange={(e) => update(entry.day, { startTime: e.target.value })}
              disabled={!entry.available}
              className="input py-1 text-xs w-28 disabled:opacity-40"
            />
            <span className="text-[var(--color-text-tertiary)]">to</span>
            <input
              type="time"
              value={entry.endTime}
              onChange={(e) => update(entry.day, { endTime: e.target.value })}
              disabled={!entry.available}
              className="input py-1 text-xs w-28 disabled:opacity-40"
            />
          </div>
        ))}
      </div>
    </div>
  );
};
