import { useState, type ReactNode } from 'react';
import {
  defaultObject,
  useStore,
  type ObjectKind,
  type SceneObject,
} from '../store/useStore';
import { CollapsibleCard, NumberField } from './primitives';
import './vision.css';

const OBJECT_KINDS: ObjectKind[] = [
  'cube',
  'sphere',
  'cylinder',
  'torus',
  'capsule',
  'phone',
  'soda_can',
];

export interface SizeRange {
  min: number;
  max: number;
  step: number;
}

/**
 * Shared "Objects" card used by the vision (detection/anomaly) panel
 * and by robotics (with owner filtering): kind select + label input +
 * Add / Clear all, then a scrollable per-object editor list (color,
 * label, kind readout, remove, size slider + number field, physics).
 *
 * The engine mirrors `sceneObjects` into entities automatically via
 * the store subscription the shell wires up — this card only mutates
 * store state.
 *
 * `ownerFilter` scopes the card: `'vision'` matches the untagged pool
 * (owner == null, used by detection/anomaly); `'rover'`/`'arm'` match
 * robot-owned objects and tag new spawns with that owner. Omitting it
 * operates on the full list. `addCustom` lets robotics route Add
 * through its own spawner (e.g. arm pickup targets) instead of
 * `defaultObject`; the kind/label inputs still flow into it.
 *
 * `sizeRange` adapts the size slider to the caller's scene scale
 * (vision 0.1–5, arm 0.02–0.2, rover 0.05–1.5 per the contract).
 */
export function SceneObjectsCard({
  title = 'Objects',
  addCustom,
  sizeRange = { min: 0.1, max: 5, step: 0.05 },
  defaultLabel = '',
  helpText,
  hidden = false,
  disabled = false,
  ownerFilter,
  footer,
}: {
  title?: string;
  /** Alternate spawner (robotics arm targets). Falls back to
   * `addObject(defaultObject(...))` when omitted. */
  addCustom?: ((kind: ObjectKind, label?: string) => string) | null;
  sizeRange?: SizeRange;
  defaultLabel?: string;
  helpText?: string;
  hidden?: boolean;
  disabled?: boolean;
  /** `'vision'` = untagged pool; `'rover'`/`'arm'` = robot-owned. */
  ownerFilter?: SceneObject['owner'] | 'vision';
  /** Extra content at the bottom of the card (e.g. the arm's
   * randomize-pickup toggle). */
  footer?: ReactNode;
}) {
  const sceneObjects = useStore((s) => s.sceneObjects);
  const addObject = useStore((s) => s.addObject);
  const updateObject = useStore((s) => s.updateObject);
  const removeObject = useStore((s) => s.removeObject);
  const clearObjects = useStore((s) => s.clearObjects);

  const [newKind, setNewKind] = useState<ObjectKind>('cube');
  const [newLabel, setNewLabel] = useState(defaultLabel);

  if (hidden) return null;

  const filtered = ownerFilter
    ? sceneObjects.filter((o) =>
        ownerFilter === 'vision' ? o.owner == null : o.owner === ownerFilter
      )
    : sceneObjects;

  const onAdd = () => {
    if (disabled) return;
    const label = newLabel || newKind;
    if (addCustom) {
      addCustom(newKind, label);
      return;
    }
    const owner =
      ownerFilter === 'vision' || ownerFilter === undefined
        ? undefined
        : ownerFilter;
    const base = defaultObject(newKind, label, filtered.length);
    addObject(owner ? { ...base, owner } : base);
  };

  const onClear = () => {
    if (disabled) return;
    // clearObjects('vision') drops the untagged pool only; a concrete
    // owner drops that owner's subset; undefined clears everything.
    clearObjects(ownerFilter);
  };

  return (
    <CollapsibleCard
      heading={`${title} (${filtered.length})`}
      badge={filtered.length > 0 ? String(filtered.length) : undefined}
      // Heading carries a live count → explicit storage key, or the
      // persisted open state would reset on every add/remove.
      storageKey={`scene-objects:${ownerFilter ?? 'vision'}:${title}`}
    >
      <div className="vision-stack">
        {helpText && <p className="vision-help">{helpText}</p>}
        <div className="vision-row">
          <select
            value={newKind}
            aria-label="Object kind"
            onChange={(e) => setNewKind(e.target.value as ObjectKind)}
            disabled={disabled}
          >
            {OBJECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="label"
            aria-label="New object label"
            disabled={disabled}
          />
        </div>
        <div className="vision-row">
          <button onClick={onAdd} disabled={disabled}>
            + Add
          </button>
          <button onClick={onClear} disabled={disabled || filtered.length === 0}>
            Clear all
          </button>
        </div>
        {filtered.length > 0 && (
          <div className="so-list">
            {filtered.map((obj) => (
              <SceneObjectRow
                key={obj.id}
                obj={obj}
                sizeRange={sizeRange}
                disabled={disabled}
                onUpdate={(patch) => updateObject(obj.id, patch)}
                onRemove={() => removeObject(obj.id)}
              />
            ))}
          </div>
        )}
        {footer}
      </div>
    </CollapsibleCard>
  );
}

function SceneObjectRow({
  obj,
  sizeRange,
  disabled,
  onUpdate,
  onRemove,
}: {
  obj: SceneObject;
  sizeRange: SizeRange;
  disabled: boolean;
  onUpdate: (patch: Partial<SceneObject>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="so-row">
      <div className="so-row-main">
        <input
          type="color"
          className="vision-color"
          value={obj.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          title={`Color: ${obj.color}`}
          aria-label={`${obj.label} color`}
          disabled={disabled}
        />
        <input
          type="text"
          value={obj.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          aria-label="Object label"
          disabled={disabled}
        />
        <span className="so-kind">{obj.kind}</span>
        <button
          className="icon"
          onClick={onRemove}
          disabled={disabled}
          title="Remove object"
        >
          ×
        </button>
      </div>
      <label className="vision-field">
        Size
        <div className="so-size-row">
          <input
            type="range"
            className="vision-range"
            min={sizeRange.min}
            max={sizeRange.max}
            step={sizeRange.step}
            value={obj.scale}
            onChange={(e) => onUpdate({ scale: Number(e.target.value) })}
            disabled={disabled}
            aria-label={`${obj.label} size`}
          />
          <NumberField
            className="so-size-number"
            min={sizeRange.min}
            max={sizeRange.max}
            step={sizeRange.step}
            value={obj.scale}
            onChange={(n) => onUpdate({ scale: n })}
            disabled={disabled}
            aria-label={`${obj.label} size value`}
          />
        </div>
      </label>
      <label className={`vision-check${disabled ? ' disabled' : ''}`}>
        <input
          type="checkbox"
          checked={obj.physics}
          onChange={(e) => onUpdate({ physics: e.target.checked })}
          disabled={disabled}
        />
        <span>Physics (falls, collides)</span>
      </label>
    </div>
  );
}
