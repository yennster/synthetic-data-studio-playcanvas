import { useState, type ReactNode } from 'react';
import { useStore } from '../../store/useStore';
import '../primitives.css';

/**
 * Sidebar card with a chevron toggle in the heading. Used by every
 * panel so cards the user doesn't need stay collapsed and the sidebar
 * remains compact; the top card in each mode passes `defaultOpen` so
 * the user lands on something useful instead of a stack of headers.
 *
 * `badge` renders next to the heading only while collapsed (e.g. the
 * realism card's "random") so the active state is visible without
 * expanding.
 *
 * Open/closed state persists across reloads via the Zustand store
 * (`state.cardOpen` / `setCardOpen`). The persistence key is, in
 * priority order:
 *   1. The explicit `storageKey` prop — required for cards whose
 *      heading text changes at runtime (e.g. "Objects (3)"), since
 *      keying on the heading would lose persistence on every count
 *      change.
 *   2. The heading itself, when it's a stable string.
 *   3. Neither → local component state only (no persistence).
 *
 * `defaultOpen` only seeds the first render; once the user toggles a
 * keyed card, the persisted value wins.
 */
export function CollapsibleCard({
  heading,
  defaultOpen = false,
  badge,
  className = 'card',
  storageKey,
  children,
}: {
  heading: ReactNode;
  defaultOpen?: boolean;
  /** Accent badge shown on the trailing edge only while collapsed. */
  badge?: ReactNode;
  /** Override for cards that need extra modifiers (e.g. `card capture-card`). */
  className?: string;
  /** Stable key under which the open/closed state is persisted. Pass
   * this whenever the heading text isn't stable. */
  storageKey?: string;
  children: ReactNode;
}) {
  const key = storageKey ?? (typeof heading === 'string' ? heading : '');
  const persistedOpen = useStore((s) => (key ? s.cardOpen[key] : undefined));
  const setCardOpen = useStore((s) => s.setCardOpen);
  // Local fallback for the unkeyed case; seeded with `defaultOpen` so
  // first-render behavior matches the keyed path.
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = key ? (persistedOpen ?? defaultOpen) : localOpen;
  const setOpen = (next: boolean) => {
    if (key) setCardOpen(key, next);
    else setLocalOpen(next);
  };

  return (
    <section className={className}>
      <h2 className="ui-collapse-h">
        <button
          type="button"
          className="ui-collapse-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="ui-collapse-heading">{heading}</span>
          {badge != null && !open && (
            <span className="ui-collapse-badge">{badge}</span>
          )}
          <span
            className={`ui-collapse-chevron${open ? ' open' : ''}`}
            aria-hidden="true"
          >
            <ChevronGlyph />
          </span>
        </button>
      </h2>
      {open && <div className="ui-collapse-body">{children}</div>}
    </section>
  );
}

/**
 * Centered chevron glyph for collapsible toggles. SVG (not a font
 * character) because a filled-triangle glyph like `▸` has its visual
 * mass offset within the character box — rotating it 90° leaves the
 * triangle visibly off-center. This stroke path is geometrically
 * symmetric around the viewBox center, so the rotation pivots in
 * place. Exported for panels that hand-roll inner section toggles
 * (e.g. custom textures) and want the same glyph.
 */
export function ChevronGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 1.5 L7 5 L3.5 8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
