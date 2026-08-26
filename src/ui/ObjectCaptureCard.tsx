import { useMemo } from 'react';
import { detectPlatform, type PlatformInfo } from '../lib/platform';
import { CollapsibleCard } from './primitives';
import './vision.css';

/**
 * Apple's RealityKit Object Capture turns a fan of photos of a real-world
 * object into a textured 3D model. There's no JavaScript surface for it:
 * it runs on-device on iPhone/iPad (iOS 17+, LiDAR) or on Mac via
 * `PhotogrammetrySession` (macOS 12+). So this card's job is just to
 * point users at the right native pipeline; they re-import the result
 * via the 3D Models card above. Ported from the original app's
 * ObjectCaptureCard — the import step is adapted to this edition's
 * .glb/.gltf importer (the original imported USDZ directly).
 */

// RealityScan (Epic Games) is free and built on Apple's Object Capture
// API on iOS 17+. We point users there rather than to a developer sample
// that has to be built from Xcode.
const REALITY_SCAN_APPSTORE_URL =
  'https://apps.apple.com/us/app/realityscan-mobile/id1584832280';
const APPLE_DOC_URL =
  'https://developer.apple.com/documentation/realitykit/realitykit-object-capture';
const HELLO_PHOTOGRAMMETRY_URL =
  'https://developer.apple.com/documentation/realitykit/creating-a-photogrammetry-command-line-app';

export function ObjectCaptureCard() {
  const platform: PlatformInfo = useMemo(() => detectPlatform(), []);

  return (
    <CollapsibleCard heading="Capture from real life">
      <div className="oc-stack">
        <p className="vision-help">
          Use Apple's{' '}
          <a href={APPLE_DOC_URL} target="_blank" rel="noreferrer">
            Object Capture
          </a>{' '}
          to turn real-world photos of an object into a 3D model, then drop
          it into the <strong>3D Models</strong> card above.
        </p>

        <PlatformBadge platform={platform} />

        <ol className="oc-steps">
          <li>
            On iPhone (iOS 17+), install{' '}
            <a href={REALITY_SCAN_APPSTORE_URL} target="_blank" rel="noreferrer">
              RealityScan
            </a>{' '}
            (Epic Games) — it's free and built on Object Capture.
          </li>
          <li>
            Walk around the object taking ~50–200 overlapping photos. Even
            lighting, no shiny / transparent surfaces.
          </li>
          <li>
            Export as <code>glTF</code>/<code>GLB</code> (convert a{' '}
            <code>USDZ</code> export via Blender).{' '}
            {platform.isMobile
              ? 'Tap the 3D Models card above to bring it into the studio.'
              : 'AirDrop the file to this machine, then drop it into the 3D Models card above.'}
          </li>
        </ol>

        {platform.supportsObjectCaptureMac && (
          <p className="vision-help">
            On Mac you can also run Apple's{' '}
            <a href={HELLO_PHOTOGRAMMETRY_URL} target="_blank" rel="noreferrer">
              <code>HelloPhotogrammetry</code>
            </a>{' '}
            CLI on a folder of photos to produce a model headlessly.
          </p>
        )}
      </div>
    </CollapsibleCard>
  );
}

function PlatformBadge({ platform }: { platform: PlatformInfo }) {
  const supported =
    platform.supportsObjectCaptureMobile || platform.supportsObjectCaptureMac;
  return (
    <div className={`oc-badge${supported ? ' ok' : ''}`}>
      {supported ? '✓' : 'ℹ'} {describePlatform(platform)}
    </div>
  );
}

function describePlatform(p: PlatformInfo): string {
  if (p.supportsObjectCaptureMobile) {
    return `Detected ${p.os === 'ipad' ? 'iPad' : 'iPhone'} on iOS ${p.iosMajor}+ — capture on this device.`;
  }
  if (p.supportsObjectCaptureMac) {
    return 'Detected Mac — Object Capture works here, or capture on iPhone and AirDrop the model over.';
  }
  if (p.isMobile && (p.iosMajor ?? 0) > 0) {
    return `Detected iOS ${p.iosMajor} — Object Capture needs iOS 17 or newer.`;
  }
  return 'Object Capture requires iOS 17+ (iPhone/iPad Pro) or macOS 12+.';
}
