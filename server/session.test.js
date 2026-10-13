/** Session token tests (no database needed): node --test server/session.test.js */
import { test } from "node:test";
import assert from "node:assert/strict";
import { issueSessionToken, verifySessionToken, isSessionToken, setSessionSecretForTests } from "./session.js";

const W = "k:" + "a".repeat(64);
const T0 = Date.parse("2026-10-13T08:00:00Z");

test("a token works for its wallet until it expires", () => {
  setSessionSecretForTests("x".repeat(32));
  const { token, expiresAt } = issueSessionToken(W, T0);
  assert.ok(isSessionToken(token));
  assert.equal(expiresAt, new Date(T0 + 30 * 24 * 3600e3).toISOString());
  assert.deepEqual(verifySessionToken(token, W, T0 + 1000), { ok: true });
  assert.equal(verifySessionToken(token, W, T0 + 31 * 24 * 3600e3).ok, false, "expired");
  assert.equal(verifySessionToken(token, "k:" + "b".repeat(64), T0).ok, false, "other wallet");
});

test("a changed or foreign token is refused", () => {
  setSessionSecretForTests("x".repeat(32));
  const { token } = issueSessionToken(W, T0);
  const [p, payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ w: "k:" + "b".repeat(64), iat: T0, exp: T0 + 9e12 })).toString("base64url");
  assert.equal(verifySessionToken(`${p}.${forged}.${sig}`, "k:" + "b".repeat(64), T0).ok, false);
  assert.equal(verifySessionToken(`${p}.${payload}.${sig.slice(0, -2)}AA`, W, T0).ok, false);
  setSessionSecretForTests("y".repeat(32));
  assert.equal(verifySessionToken(token, W, T0).ok, false, "signed with another server secret");
  assert.equal(isSessionToken({ cmd: "x" }), false);
});
