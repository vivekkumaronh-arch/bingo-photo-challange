import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRearCameraConstraintAttempts,
  computeScaledDimensions,
  mapCameraError,
} from './cameraHelpers';

test('computeScaledDimensions scales oversized landscape and portrait images proportionally', () => {
  assert.deepEqual(computeScaledDimensions(2400, 1200, 1200), { width: 1200, height: 600 });
  assert.deepEqual(computeScaledDimensions(1200, 2400, 1200), { width: 600, height: 1200 });
  assert.deepEqual(computeScaledDimensions(800, 600, 1200), { width: 800, height: 600 });
  assert.throws(() => computeScaledDimensions(0, 480, 1200));
});

test('buildRearCameraConstraintAttempts prefers rear environment camera first with safe fallbacks', () => {
  const attempts = buildRearCameraConstraintAttempts();
  assert.equal(attempts.length, 3);
  assert.deepEqual((attempts[0].video as MediaTrackConstraints).facingMode, {
    ideal: 'environment',
  });
  assert.equal((attempts[1].video as MediaTrackConstraints).facingMode, 'environment');
  assert.equal(attempts[2].video, true);
  assert.equal(attempts[0].audio, false);
});

test('mapCameraError provides clear messages for insecure contexts, denied permissions, and missing cameras', () => {
  assert.match(
    mapCameraError(null, { isSecureContext: false, hasMediaDevices: false }),
    /HTTPS or localhost/i,
  );
  assert.match(
    mapCameraError(null, { isSecureContext: true, hasMediaDevices: false }),
    /not supported/i,
  );
  assert.match(mapCameraError({ name: 'NotAllowedError' }), /permission was denied/i);
  assert.match(mapCameraError({ name: 'PermissionDeniedError' }), /permission was denied/i);
  assert.match(mapCameraError({ name: 'NotFoundError' }), /No camera was found/i);
  assert.match(mapCameraError({ name: 'DevicesNotFoundError' }), /No camera was found/i);
  assert.match(mapCameraError({ name: 'NotReadableError' }), /busy or unavailable/i);
  assert.match(mapCameraError({ name: 'OverconstrainedError' }), /compatible camera/i);
});
