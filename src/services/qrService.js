import crypto from 'crypto';
import QRCode from 'qrcode';
import db from '../db/database.js';

/**
 * Generate a short-lived, stage-specific cryptographic QR token.
 */
export async function generateQRStageToken(sessionId, stage, ttlSeconds = 60) {
  // Deactivate any previous active tokens for this session & stage
  db.prepare(`
    UPDATE qr_tokens
    SET is_active = 0
    WHERE session_id = ? AND stage = ?
  `).run(sessionId, stage);

  const randomNonce = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  // Insert new token into DB
  const stmt = db.prepare(`
    INSERT INTO qr_tokens (session_id, stage, token, expires_at, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);
  stmt.run(sessionId, stage, randomNonce, expiresAt);

  // Form structured payload to encode inside QR code
  const payload = JSON.stringify({
    session_id: sessionId,
    stage: stage,
    token: randomNonce,
    expires_at: expiresAt
  });

  // Generate Data URL for professor screen rendering
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 380,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });

  return {
    rawPayload: payload,
    token: randomNonce,
    stage: stage,
    expires_at: expiresAt,
    qrDataUrl: qrDataUrl
  };
}

/**
 * Parses scanned QR text string and extracts token object.
 */
export function parseQRScannedData(scannedText) {
  try {
    const data = JSON.parse(scannedText);
    if (!data.session_id || !data.stage || !data.token) {
      return null;
    }
    return data;
  } catch (e) {
    // If it's a raw token string fallback
    return null;
  }
}
