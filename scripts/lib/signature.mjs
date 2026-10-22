import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/** The public half of the index signing key, SPKI DER in base64. Also in keys/index-signing.pub and the README. */
export const PUBLIC_KEY = "MCowBQYDK2VwAyEAkZEZ6pKsyVb9KBFvI56NOo6nsaldB4j3cS/ds9Y/shM=";

/** Ed25519 signature of the exact bytes, in base64 (64 bytes once decoded). The key is PKCS8 PEM. */
export function signIndex(bytes, privatePem) {
  const key = createPrivateKey({ key: privatePem, format: "pem" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`the signing key must be Ed25519, found ${key.asymmetricKeyType}`);
  return sign(null, bytes, key).toString("base64");
}

export function verifyIndex(bytes, signatureBase64, publicKeyBase64 = PUBLIC_KEY) {
  const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
  const signature = Buffer.from(signatureBase64.trim(), "base64");
  if (signature.length !== 64) return false;
  return verify(null, bytes, key, signature);
}
