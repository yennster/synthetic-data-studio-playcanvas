import {
  useStore,
  type RealismMode,
  type RealismSettings,
} from '../store/useStore';
import {
  CollapsibleCard,
  RadioPills,
  SliderRow,
  ToggleSwitch,
  type RadioPillOption,
} from './primitives';
import './vision.css';

/**
 * Realism post-process picker — shared by the vision panel and (later)
 * robotics when object detection is on. Two visible modes:
 *
 *   - Off: raw synthetic render.
 *   - Photo FX (internal value 'random' — MUST stay 'random' for
 *     persistence + EI realism_mode metadata compatibility): CPU pixel
 *     transforms applied to every captured PNG.
 *
 * A third mode 'diffusion' exists in the types/API but is deliberately
 * not offered in the picker. Geometry never moves, so bounding boxes
 * stay valid regardless of the settings here.
 */
const MODE_OPTIONS: RadioPillOption<RealismMode>[] = [
  { value: 'off', label: 'Off', hint: 'Raw synthetic render.' },
  {
    value: 'random',
    label: 'Photo FX',
    hint:
      'Each capture is run through the per-effect transforms below — ' +
      'film grain, radial chromatic aberration, vignette, color jitter, ' +
      'and a JPEG round-trip. Bounding boxes are preserved (geometry ' +
      'never moves; only pixel values change).',
  },
];

/** Declarative slider list so the card renders one loop, not five blocks. */
const EFFECTS: {
  key: 'grain' | 'chromatic' | 'vignette' | 'jitter' | 'jpeg';
  label: string;
  hint: string;
}[] = [
  {
    key: 'grain',
    label: 'Film grain',
    hint: 'Gaussian noise per RGB channel — mimics sensor noise.',
  },
  {
    key: 'chromatic',
    label: 'Chromatic aberration',
    hint:
      'Radial RGB split — zero at the image center, max at the corners. ' +
      'How real lenses actually fail.',
  },
  {
    key: 'vignette',
    label: 'Vignette',
    hint: 'Smooth radial darkening from center to corners.',
  },
  {
    key: 'jitter',
    label: 'Color jitter',
    hint:
      'Per-channel gain + brightness offset — simulates white-balance ' +
      'drift and exposure variation between captures.',
  },
  {
    key: 'jpeg',
    label: 'JPEG artifacts',
    hint:
      'Round-trip the image through JPEG to introduce real 8×8 DCT ' +
      'compression blocks and mild color banding. 0% skips the round-trip.',
  },
];

const formatPercent = (v: number) => `${(v * 100).toFixed(0)}%`;

export function RealismCard() {
  const realism = useStore((s) => s.realism);
  const setRealism = useStore((s) => s.setRealism);
  const active = realism.mode !== 'off';

  return (
    <CollapsibleCard
      heading="Realism"
      // Collapsed badge only when the pass is active AND per-capture
      // randomization is on — deterministic Photo FX doesn't need an
      // at-a-glance flag.
      badge={active && realism.randomize ? 'random' : undefined}
    >
      <div className="vision-stack">
        <RadioPills
          options={MODE_OPTIONS}
          value={realism.mode}
          onChange={(mode) => setRealism({ mode })}
          ariaLabel="Realism mode"
        />
        {active && (
          <>
            {EFFECTS.map((e) => (
              <SliderRow
                key={e.key}
                label={e.label}
                hint={e.hint}
                value={realism[e.key]}
                min={0}
                max={1}
                step={0.05}
                formatValue={formatPercent}
                onChange={(next) =>
                  setRealism({ [e.key]: next } as Partial<RealismSettings>)
                }
              />
            ))}
            <ToggleSwitch
              title="Randomize per capture"
              help="On: each capture re-samples its effective intensity for every effect in [0, slider value], so a batch sees varied realism instead of identical settings on every PNG. The sliders above become the upper bound. Off: each capture uses the slider values verbatim."
              on={realism.randomize}
              onChange={(next) => setRealism({ randomize: next })}
            />
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
