import { useRef, type KeyboardEvent } from 'react';
import '../primitives.css';

export interface RadioPillOption<V extends string = string> {
  value: V;
  label: string;
  /** Tooltip on the pill; the active option's hint also renders as a
   * line below the group. */
  hint?: string;
}

/**
 * Generic segmented radio-pill row: a sunk rail of pills where the
 * active one is highlighted with the accent. Used for mode-class
 * pickers (drop/throw/push/shake, rover events, arm trajectories,
 * realism mode, sensor modality, POV mounts…).
 *
 *  - Proper `radiogroup`/`radio` semantics with `aria-checked` and a
 *    roving tabindex; arrow keys move + select, Home/End jump.
 *  - Optional hint line below the rail showing the active option's
 *    hint (each pill also carries its hint as a native tooltip).
 *  - `columns` switches the rail from a wrapping flex row to a fixed
 *    N-column grid — use for long label sets (e.g. 5 trajectories as
 *    3 + 2) where flex-wrap would stretch the last pill unevenly.
 */
export function RadioPills<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
  disabled,
  showHint = true,
}: {
  options: readonly RadioPillOption<V>[];
  value: V;
  onChange: (next: V) => void;
  /** Accessible name for the radiogroup. */
  ariaLabel: string;
  /** Fixed column count; omit for a wrapping flex row of equal pills. */
  columns?: number;
  disabled?: boolean;
  /** Render the active option's hint under the pills (default true). */
  showHint?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const active = options.find((o) => o.value === value);

  const moveTo = (index: number) => {
    const next = options[(index + options.length) % options.length];
    onChange(next.value);
    refs.current[(index + options.length) % options.length]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(options.length - 1);
        break;
    }
  };

  return (
    <div className="ui-pills-wrap">
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={`ui-pills${columns ? ' grid' : ''}`}
        style={
          columns
            ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
            : undefined
        }
        onKeyDown={onKeyDown}
      >
        {options.map((option, i) => (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={i === activeIndex ? 0 : -1}
            className="ui-pill"
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {showHint && active?.hint && (
        <p className="ui-pill-hint">{active.hint}</p>
      )}
    </div>
  );
}
