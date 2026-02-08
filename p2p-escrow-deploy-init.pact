;; Run this in a SEPARATE transaction AFTER deploying p2p-escrow.pact (module only).
;; Run ONLY ON FIRST DEPLOY. If "table already exists", tables exist; for upgrades omit.
;;
;; "Module admin is necessary but has not been acquired" = the signer did not GRANT the capability.
;;
;; What "grant the capability" means:
;;   The transaction needs the capability free.p2p-escrow-again.GOVERNANCE to run. A capability
;;   is "granted" when a signer SIGNS FOR IT — i.e. the signing request must list this capability
;;   and the signer approves it. If you paste this Pact code in Chainweaver, the signing request
;;   may NOT include GOVERNANCE, so you sign without granting it → error.
;;
;; EASIEST FIX: Use the dApp. Connect with the SAME wallet that deployed the module, go to the
;; home page, scroll to "Initialize contract (deployers only)", click "Run init (create tables + config)".
;; The app builds the transaction WITH the GOVERNANCE capability in the signer caps, so when you
;; sign in the wallet you are granting it. Then init succeeds.

(with-capability (free.p2p-escrow-again.GOVERNANCE)
  (create-table free.p2p-escrow-again.escrows)
  (create-table free.p2p-escrow-again.reputation)
  (create-table free.p2p-escrow-again.config)
  (free.p2p-escrow-again.init-config))
