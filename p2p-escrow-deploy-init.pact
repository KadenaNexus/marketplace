;; Run this in a SEPARATE transaction AFTER deploying p2p-escrow.pact (module only).
;; Run ONLY ON FIRST DEPLOY. If "table already exists", tables exist; for upgrades omit.
;;
;; GOVERNANCE requires "admin-keyset" in the transaction data. Include data: "admin-keyset" = { "keys": ["<your-admin-pubkey>"], "pred": "keys-all" }.
;;
;; "Module admin is necessary but has not been acquired" = the signer did not GRANT the capability, or "admin-keyset" is missing/wrong.
;;   The transaction needs the capability free.p2p-escrow-v10.GOVERNANCE to run. A capability
;;   is "granted" when a signer SIGNS FOR IT — and the signer must satisfy the keyset in "admin-keyset".
;;   So: add "admin-keyset" to the tx data, sign with that key, and add the GOVERNANCE capability when signing.
;;
;; EASIEST FIX: Use the dApp. Connect with the SAME wallet that deployed the module, go to the
;; home page, scroll to "Initialize contract (deployers only)", click "Run init (create tables + config)".
;; The app builds the transaction WITH the GOVERNANCE capability and admin-keyset in data, so when you
;; sign in the wallet you are granting it. Then init succeeds.

(with-capability (free.p2p-escrow-v10.GOVERNANCE)
  (create-table free.p2p-escrow-v10.escrows)
  (create-table free.p2p-escrow-v10.reputation)
  (create-table free.p2p-escrow-v10.config)
  (free.p2p-escrow-v10.init-config))
