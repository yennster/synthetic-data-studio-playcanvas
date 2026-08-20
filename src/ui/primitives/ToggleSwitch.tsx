import '../primitives.css';

/**
 * Reusable on/off toggle row: title + On/Off state pill + help text on
 * the left, an accessible switch button on the right.
 *
 *  - `role="switch"` + `aria-checked` for screen readers.
 *  - `aria-label` is "Turn {title} on/off" so each instance is uniquely
 *    identifiable in the a11y tree even when the title is purely visual.
 *  - `titleAs="h3"` renders the title with section-header weight for
 *    switches that head a whole card section (e.g. Object detection).
 *  - `stateLabels` overrides the default "On"/"Off" pill text.
 */
export function ToggleSwitch({
  title,
  titleAs = 'span',
  help,
  on,
  onChange,
  disabled,
  stateLabels,
}: {
  title: string;
  /** Element used to render the title. Pass `'h3'` for section-header
   * weight (master toggles that act as a card heading). */
  titleAs?: 'span' | 'h3';
  /** Help text below the title; typically switched on the `on` state
   * by the caller. */
  help?: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Override the default "On" / "Off" pill text. */
  stateLabels?: { on: string; off: string };
}) {
  const labels = stateLabels ?? { on: 'On', off: 'Off' };
  const Title = titleAs;
  return (
    <div className={`ui-switch-row${disabled ? ' disabled' : ''}`}>
      <div className="ui-switch-copy">
        <div className="ui-switch-heading">
          <Title
            className={`ui-switch-title${titleAs === 'h3' ? ' as-h3' : ''}`}
          >
            {title}
          </Title>
          <span className={`ui-switch-state${on ? ' on' : ''}`}>
            {on ? labels.on : labels.off}
          </span>
        </div>
        {help && <p className="ui-switch-help">{help}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? `Turn ${title} off` : `Turn ${title} on`}
        className={`ui-switch${on ? ' on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!on)}
      >
        <span className="ui-switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
