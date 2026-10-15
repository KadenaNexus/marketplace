;; DEPLOYED COPY. Module free.p2p-escrow-v10 on mainnet01, chain 1.
;; This file is the reference for what is live. Do not edit it; edit the root p2p-escrow.pact,
;; deploy as a new version (v11, ...), then copy the deployed file here and update contracts/README.md.
;; T1_SECONDS 3600 (1 h to fund), T2_SECONDS 14400 (4 h to mark paid), T3_SECONDS 3600 (1 h to release).

(namespace 'free)

;; Redefining the same keyset is safe — governance key must sign to rotate it.
(define-keyset "free.p2p-escrow-v10-gov" (read-keyset "gov-keyset"))

(module p2p-escrow-v10 GOVERNANCE
  (defcap GOVERNANCE ()
    (enforce-guard (keyset-ref-guard "free.p2p-escrow-v10-gov")))

  (defconst EPOCH:time (time "1970-01-01T00:00:00Z"))

  ;; ACCOUNT_AUTH: proves the caller controls the given k: account.
  ;; The signer declares (ACCOUNT_AUTH "k:xxx") in their capability list.
  ;; enforce-guard runs INSIDE the defcap body, so the key is active at the
  ;; time of the check — this fixes "Keyset failure" with Ecko wallet.
  (defcap ACCOUNT_AUTH (account:string)
    (enforce-guard (at "guard" (coin.details account))))

  ;; ESCROW_VAULT_DEBIT: guards the vault account for coin transfers.
  ;; Uses enforce-guard directly — Pact does not allow with-capability inside
  ;; a defcap body. Callers (release/refund/timeout-funded-refund) must declare
  ;; this capability in their signer clist so their key is active here.
  (defcap ESCROW_VAULT_DEBIT (id:string amount:decimal)
    (with-read escrows id
      { "creator" := c, "buyer" := b, "arbiter" := a
      , "amount" := amt, "state" := s, "side" := side }
      (enforce (contains s ["PAID" "FUNDED" "DISPUTED"]) "Invalid state for vault debit")
      (enforce (= amount amt) "Debit amount must match escrow amount")
      (enforce-one "Only arbiter or KDA holder (for PAID/FUNDED) can debit vault"
        [ (enforce-guard (at "guard" (coin.details a)))
          (and (enforce (contains s ["PAID" "FUNDED"]) "Invalid state")
               (and (enforce (= side "SELL") "Not sell side")
                    (enforce-guard (at "guard" (coin.details c)))))
          (and (enforce (contains s ["PAID" "FUNDED"]) "Invalid state")
               (and (enforce (= side "BUY") "Not buy side")
                    (enforce-guard (at "guard" (coin.details b))))) ])))

  (defun require-ESCROW_VAULT_DEBIT (id:string amount:decimal)
    (require-capability (ESCROW_VAULT_DEBIT id amount)))
  (defun create-ESCROW_VAULT_DEBIT-guard (id:string amount:decimal)
    (create-user-guard (require-ESCROW_VAULT_DEBIT id amount)))

  (defconst PLATFORM_ARBITER "k:eda1ef1f1528f5f72e153fcb9c2c8178317749429bd48aaf34b6b52fa16598e1")
  (defconst T1_SECONDS 3600)
  (defconst T2_SECONDS 14400)
  (defconst T3_SECONDS 3600)

  (defschema escrow
    creator:string
    buyer:string
    arbiter:string
    amount:decimal
    state:string
    side:string
    acceptedAt:time
    fundedAt:time
    paidAt:time)

  (defschema reputation-row
    totalTrades:integer
    successfulTrades:integer
    disputesCount:integer)
  (defschema config-row
    arbiter:string
    t1:integer
    t2:integer
    t3:integer)

  (deftable escrows:{escrow})
  (deftable reputation:{reputation-row})
  (deftable config:{config-row})

  (defun init-config ()
    (with-capability (GOVERNANCE)
      (insert config "global"
        { "arbiter": PLATFORM_ARBITER, "t1": T1_SECONDS, "t2": T2_SECONDS, "t3": T3_SECONDS })))

  (defun set-config (arbiter t1 t2 t3)
    (with-capability (GOVERNANCE)
      (enforce (> (length arbiter) 0) "Arbiter required")
      (enforce (> t1 0) "T1 must be > 0")
      (enforce (> t2 0) "T2 must be > 0")
      (enforce (> t3 0) "T3 must be > 0")
      (write config "global" { "arbiter": arbiter, "t1": t1, "t2": t2, "t3": t3 })))

  (defun get-arbiter ()
    (with-read config "global" { "arbiter" := a }
      (if (> (length a) 0) a PLATFORM_ARBITER)))
  (defun get-t1 () (with-read config "global" { "t1" := t } t))
  (defun get-t2 () (with-read config "global" { "t2" := t } t))
  (defun get-t3 () (with-read config "global" { "t3" := t } t))

  (defun inc-reputation (wallet success)
    (with-default-read reputation wallet
      { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes }
      (write reputation wallet
        { "totalTrades": (+ total 1)
        , "successfulTrades": (if success (+ ok 1) ok)
        , "disputesCount": (if success disputes (+ disputes 1)) })))

  (defun get-reputation (wallet)
    (with-default-read reputation wallet
      { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes }
      { "totalTrades": total, "successfulTrades": ok, "disputesCount": disputes }))

  (defun create-offer (id creator amount side)
    (with-capability (ACCOUNT_AUTH creator)
      (enforce (contains side ["SELL" "BUY"]) "Invalid side: must be SELL or BUY")
      (with-default-read escrows id { "creator": "" } { "creator" := c }
        (enforce (= (length c) 0) "Escrow exists"))
      (enforce (> amount 0.0) "Amount must be > 0")
      (enforce (> (length creator) 0) "Creator required")
      (enforce (!= creator (get-arbiter)) "Creator and arbiter must be different")
      (insert escrows id
        { "creator": creator, "buyer": "", "arbiter": (get-arbiter)
        , "amount": amount, "state": "CREATED", "side": side
        , "acceptedAt": EPOCH, "fundedAt": EPOCH, "paidAt": EPOCH })))

  ;; accepter is now an explicit parameter (frontend already passes it).
  ;; ACCOUNT_AUTH proves the accepter controls their account.
  (defun accept-offer (id accepter:string)
    (with-capability (ACCOUNT_AUTH accepter)
      (let ((now (at "block-time" (chain-data))))
        (with-read escrows id { "creator" := c, "state" := s }
          (enforce (= s "CREATED") "Invalid state: must be CREATED")
          (enforce (!= accepter c) "Cannot accept your own offer")
          (update escrows id { "buyer": accepter, "state": "ACCEPTED", "acceptedAt": now })))))

  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (with-capability (ACCOUNT_AUTH c)
        (update escrows id { "state": "CLOSED" }))))

  (defun delete-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only delete offer in CREATED state")
      (with-capability (ACCOUNT_AUTH c)
        (update escrows id { "state": "DELETED" }))))

  (defun cancel-accepted-offer (id)
    (let ((now (at "block-time" (chain-data)))
          (t1  (get-t1)))
      (with-read escrows id { "creator" := c, "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Can only cancel in ACCEPTED state")
        (enforce (<= now (add-time acceptedAt t1)) "T1 expired — use timeout-accepted-close instead")
        (with-capability (ACCOUNT_AUTH c)
          (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": EPOCH })))))

  (defun deposit (id)
    (let ((now (at "block-time" (chain-data)))
          (t1  (get-t1)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := a
        , "state" := s, "side" := side, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state: must be ACCEPTED")
        (enforce (<= now (add-time acceptedAt t1))
          "Funding period expired (T1) - call timeout-accepted-close")
        (enforce-one "Only KDA holder can deposit"
          [ (and (enforce (= side "SELL") "Not sell side")
                 (with-capability (ACCOUNT_AUTH c) true))
            (and (enforce (= side "BUY") "Not buy side")
                 (with-capability (ACCOUNT_AUTH b) true)) ])
        (let* ((depositor (if (= side "SELL") c b))
               (guard     (create-ESCROW_VAULT_DEBIT-guard id a))
               (vault     (create-principal guard)))
          (coin.transfer-create depositor vault guard a)
          (update escrows id { "state": "FUNDED", "fundedAt": now })))))

  (defun mark-paid (id)
    (let ((now (at "block-time" (chain-data)))
          (t2  (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "state" := s
        , "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state: must be FUNDED")
        (enforce (<= now (add-time fundedAt t2))
          "Mark-paid period expired (T2) - seller can call timeout-funded-refund")
        (enforce-one "Only fiat payer can mark paid"
          [ (and (enforce (= side "SELL") "Not sell side")
                 (with-capability (ACCOUNT_AUTH b) true))
            (and (enforce (= side "BUY") "Not buy side")
                 (with-capability (ACCOUNT_AUTH c) true)) ])
        (update escrows id { "state": "PAID", "paidAt": now }))))

  (defun release (offerId:string)
    (let ((now (at "block-time" (chain-data)))
          (t3  (get-t3)))
      (with-read escrows offerId
        { "creator" := c, "buyer" := b, "arbiter" := a
        , "amount" := amt, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (contains s ["PAID" "DISPUTED"]) "Invalid state for release")
        (if (= s "PAID")
          (enforce (<= now (add-time paidAt t3))
            "Release period expired (T3) - call timeout-paid-dispute")
          true)
        (enforce-one "Only KDA holder or arbiter can release - DISPUTED only arbiter"
          [ (with-capability (ACCOUNT_AUTH a) true)
            (and (enforce (= s "PAID") "Not PAID state")
                 (and (enforce (= side "SELL") "Not sell side")
                      (with-capability (ACCOUNT_AUTH c) true)))
            (and (enforce (= s "PAID") "Not PAID state")
                 (and (enforce (= side "BUY") "Not buy side")
                      (with-capability (ACCOUNT_AUTH b) true))) ])
        (let ((vault (create-principal (create-ESCROW_VAULT_DEBIT-guard offerId amt))))
          (with-capability (ESCROW_VAULT_DEBIT offerId amt)
            (if (= side "SELL")
              (coin.transfer vault b amt)
              (coin.transfer vault c amt)))
          (update escrows offerId { "state": "COMPLETED" })
          (let ((seller    (if (= side "SELL") c b))
                (recipient (if (= side "SELL") b c)))
            (inc-reputation seller true)
            (inc-reputation recipient true))))))

  (defun refund (offerId:string)
    (with-read escrows offerId
      { "creator" := c, "buyer" := b, "arbiter" := a
      , "amount" := amt, "state" := s, "side" := side }
      (enforce (contains s ["PAID" "FUNDED" "DISPUTED"]) "Invalid state for refund")
      (with-capability (ACCOUNT_AUTH a)
        (let ((vault     (create-principal (create-ESCROW_VAULT_DEBIT-guard offerId amt)))
              (refund-to (if (= side "SELL") c b))
              (other     (if (= side "SELL") b c)))
          (with-capability (ESCROW_VAULT_DEBIT offerId amt)
            (coin.transfer vault refund-to amt))
          (update escrows offerId { "buyer": "", "state": "REFUNDED" })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))

  (defun timeout-accepted-close (id)
    (let ((now (at "block-time" (chain-data)))
          (t1  (get-t1)))
      (with-read escrows id { "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce (!= acceptedAt EPOCH) "Missing acceptedAt")
        (enforce (> now (add-time acceptedAt t1)) "Funding period not yet expired")
        (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": EPOCH }))))

  (defun timeout-funded-refund (id)
    (let ((now (at "block-time" (chain-data)))
          (t2  (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := amt
        , "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state")
        (enforce (!= fundedAt EPOCH) "Missing fundedAt")
        (enforce (> now (add-time fundedAt t2)) "Mark-paid period not yet expired")
        (enforce-one "Only seller can timeout-refund"
          [ (and (enforce (= side "SELL") "Not sell side")
                 (with-capability (ACCOUNT_AUTH c) true))
            (and (enforce (= side "BUY") "Not buy side")
                 (with-capability (ACCOUNT_AUTH b) true)) ])
        (let ((vault     (create-principal (create-ESCROW_VAULT_DEBIT-guard id amt)))
              (refund-to (if (= side "SELL") c b))
              (other     (if (= side "SELL") b c)))
          (with-capability (ESCROW_VAULT_DEBIT id amt)
            (coin.transfer vault refund-to amt))
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": EPOCH })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))

  (defun timeout-paid-dispute (id)
    (let ((now (at "block-time" (chain-data)))
          (t3  (get-t3)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (= s "PAID") "Invalid state")
        (enforce (!= paidAt EPOCH) "Missing paidAt")
        (enforce (> now (add-time paidAt t3)) "Release period not yet expired")
        (enforce-one "Only buyer or seller can dispute"
          [ (with-capability (ACCOUNT_AUTH b) true)
            (with-capability (ACCOUNT_AUTH c) true) ])
        (update escrows id { "state": "DISPUTED" }))))

  (defun get-escrow (id)
    (read escrows id))

  (defun list-escrow-ids ()
    (fold-db escrows
      (lambda (k obj) (!= (at "state" obj) "DELETED"))
      (lambda (k obj) k)))
)


(create-table free.p2p-escrow-v10.escrows)
(create-table free.p2p-escrow-v10.reputation)
(create-table free.p2p-escrow-v10.config)
(free.p2p-escrow-v10.init-config)