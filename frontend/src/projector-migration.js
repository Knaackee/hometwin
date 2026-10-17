const LEGACY_SCREEN_STYLE = 'projector';

function projectorId(devices, screenId) {
  const base = `${screenId}_projector`;
  if (!devices.some((device) => device.id === base)) return base;
  let suffix = 2;
  while (devices.some((device) => device.id === `${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function projectorPosition(screen) {
  const throwDistance = (screen.length || 2.2) * 1.5;
  const angle = ((screen.rot || 0) * Math.PI) / 180;
  return [
    screen.pos[0] + Math.sin(angle) * throwDistance,
    screen.pos[1] + Math.cos(angle) * throwDistance,
  ];
}

// New projector-style TVs represent only a screen. Mark them so loading the plan does
// not mistake them for the pre-split compound asset.
export function markStandaloneProjectorScreen(device) {
  if (device?.kind === 'tv' && device.style === LEGACY_SCREEN_STYLE) device.projector_screen_only = true;
  return device;
}

// Legacy projector screens also rendered a ceiling projector at a fixed local offset.
// Split that body into its own device once while leaving the screen exactly where it was.
export function migrateLegacyProjectors(plan) {
  let migrated = 0;
  for (const level of plan?.levels || []) {
    const devices = level.devices || [];
    for (const screen of [...devices]) {
      if (screen.kind !== 'tv' || screen.style !== LEGACY_SCREEN_STYLE || screen.projector_id || screen.projector_screen_only) continue;
      const id = projectorId(devices, screen.id);
      const projector = {
        id,
        kind: 'projector',
        style: 'ceiling',
        pos: projectorPosition(screen),
        rot: screen.rot || 0,
        y: (level.height ?? 2.6) - 0.37,
        migrated_from_screen_id: screen.id,
      };
      if (screen.entity_id) projector.entity_id = screen.entity_id;
      if (screen.hidden) projector.hidden = true;
      if (screen.locked) projector.locked = true;
      devices.push(projector);
      screen.projector_id = id;
      migrated += 1;
    }
  }
  return migrated;
}
