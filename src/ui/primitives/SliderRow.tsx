import '../primitives.css';

/**
 * Labeled range-input row: uppercase micro-label on the left, the
 * formatted value right-aligned (tabular numerals), and the slider
 * underneath. Centralizes:
 *
 *  - the value-readout format (`formatValue`, default `v.toFixed(2)` —
 *    pass e.g. `(v) => `${v.toFixed(0)}°`` or a percent formatter),
 *  - the `disabled` plumbing (dims the whole row),
 *  - the `hint` tooltip (native `title` on the row).
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** How to render the value next to the label. Defaults to `value.toFixed(2)`. */
  formatValue?: (v: number) => string;
  /** Native `title` tooltip on the row. */
  hint?: string;
  disabled?: boolean;
}) {
  const fmt = formatValue ?? ((v: number) => v.toFixed(2));
  return (
    <label className={`ui-field${disabled ? ' disabled' : ''}`} title={hint}>
      <span className="ui-field-label">
        <span>{label}</span>
        <span className="ui-field-value">{fmt(value)}</span>
      </span>
      <input
        type="range"
        className="ui-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
