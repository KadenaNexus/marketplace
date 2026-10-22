/**
 * The client's address for rate limiting. Behind the Nginx on the same machine every request arrives from
 * 127.0.0.1, so keying on req.ip would make one busy visitor throttle everyone. Nginx sets X-Real-IP
 * (deploy/staging/nginx-*.conf); it is trusted only when the connection really comes from localhost, so a
 * visitor talking to the server directly cannot pick their own key.
 */
import { ipKeyGenerator } from "express-rate-limit";

const LOCAL = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

export function realIp(req) {
  const peer = req.socket?.remoteAddress || "";
  const fwd = req.get("X-Real-IP");
  return (fwd && LOCAL.test(peer)) ? fwd : (req.ip || peer);
}

/** keyGenerator for express-rate-limit (IPv6 addresses are grouped by /56, as the library recommends). */
export const ipKey = (req) => ipKeyGenerator(realIp(req));
