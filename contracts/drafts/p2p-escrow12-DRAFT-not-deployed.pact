(module p2p-escrow12 GOVERNANCE
  (defconst GOV-KEYSET (read-keyset "gov-keyset"))
  (defcap GOVERNANCE ()
    (enforce-keyset GOV-KEYSET))
  (defconst VAULT_ACCOUNT "p2p-escrow-vault-")
  ;; Vault name: VAULT_ACCOUNT + id. Static name so depositor can sign (coin.TRANSFER depositor vault amount).
  (defcap ESCROW_VAULT_DEBIT (id:string recipient:string amount:decimal)
    (with-read escrows id { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side }
      (enforce (contains s ["PAID" "FUNDED" "DISPUTED"]) "Invalid state for vault debit")
      (enforce (= amount amt) "Debit amount must match escrow amount")
      (enforce (or (= recipient c) (= recipient b)) "Recipient must be creator or buyer")
      (enforce
        (or (= (at "sender" (chain-data)) a)
            (or (and (contains s ["PAID" "FUNDED"]) (and (= side "SELL") (= (at "sender" (chain-data)) c)))
                (and (contains s ["PAID" "FUNDED"]) (and (= side "BUY") (= (at "sender" (chain-data)) b)))))
        "Only arbiter or KDA holder (for PAID/FUNDED) can debit vault")))
  (defun require-ESCROW_VAULT_DEBIT (id:string recipient:string amount:decimal)
    (require-capability (ESCROW_VAULT_DEBIT id recipient amount)))
  (defun create-ESCROW_VAULT_DEBIT-guard (id:string recipient:string amount:decimal)
    (create-user-guard (require-ESCROW_VAULT_DEBIT id recipient amount)))

  (defconst PLATFORM_ARBITER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")
  (defconst T1_SECONDS 1200)
  (defconst T2_SECONDS 1200)
  (defconst T3_SECONDS 1200)
  (defschema escrow
    creator:string
    buyer:string
    arbiter:string
    amount:decimal
    state:string
    side:string
    acceptedAt:string
    fundedAt:string
    paidAt:string)
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
  (defun get-t1 ()
    (with-read config "global" { "t1" := t } t))
  (defun get-t2 ()
    (with-read config "global" { "t2" := t } t))
  (defun get-t3 ()
    (with-read config "global" { "t3" := t } t))
  (defun inc-reputation (wallet success)
    (with-default-read reputation wallet { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes }
      (write reputation wallet
        { "totalTrades": (+ total 1), "successfulTrades": (if success (+ ok 1) ok), "disputesCount": (if success disputes (+ disputes 1)) })))
  (defun get-reputation (wallet)
    (with-default-read reputation wallet { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes }
      { "totalTrades": total, "successfulTrades": ok, "disputesCount": disputes }))
  (defun create-offer (id creator amount side)
    (enforce (= (at "sender" (chain-data)) creator) "Creator must be the transaction sender")
    (with-default-read escrows id { "creator": "" } { "creator" := c }
      (enforce (= (length c) 0) "Escrow exists"))
    (enforce (> amount 0.0) "Amount must be > 0")
    (enforce (> (length creator) 0) "Creator required")
    (enforce (!= creator (get-arbiter)) "Creator and arbiter must be different")
    (insert escrows id
      { "creator": creator, "buyer": "", "arbiter": (get-arbiter), "amount": amount, "state": "CREATED", "side": side, "acceptedAt": "", "fundedAt": "", "paidAt": "" }))
  (defun accept-offer (id)
    (let ((accepter (at "sender" (chain-data)))
          (acceptedAt-str (format-time "%Y-%m-%dT%H:%M:%SZ" (at "block-time" (chain-data)))))
      (with-read escrows id { "creator" := c, "state" := s }
        (enforce (= s "CREATED") "Invalid state: must be CREATED")
        (enforce (!= accepter c) "Cannot accept your own offer")
        (update escrows id { "buyer": accepter, "state": "ACCEPTED", "acceptedAt": acceptedAt-str }))))
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (at "sender" (chain-data)) c) "Only creator can close")
      (update escrows id { "state": "CLOSED" })))
  ;; Delete offer: only for CREATED (unaccepted) offers. Sets state to DELETED so list-escrow-ids excludes them.
  (defun delete-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only delete offer in CREATED state")
      (enforce (= (at "sender" (chain-data)) c) "Only creator can delete offer")
      (update escrows id { "state": "DELETED" })))
  (defun deposit (id)
    (let ((now (at "block-time" (chain-data)))
          (t1 (get-t1)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := a, "state" := s, "side" := side, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state: must be ACCEPTED")
        (enforce
          (or (= (length acceptedAt) 0)
              (<= now (add-time (time acceptedAt) t1)))
          "Funding period expired (T1) - call timeout-accepted-close")
        (enforce
          (or (and (= side "SELL") (= c (at "sender" (chain-data))))
              (and (= side "BUY") (= b (at "sender" (chain-data)))))
          "Only KDA holder can deposit")
        (let ((depositor (if (= side "SELL") c b))
              (fundedAt-str (format-time "%Y-%m-%dT%H:%M:%SZ" (at "block-time" (chain-data))))
              (vault (concat [VAULT_ACCOUNT id])))
          (coin.transfer-create depositor vault (create-ESCROW_VAULT_DEBIT-guard id (if (= depositor c) b c) a) a)
          (update escrows id { "state": "FUNDED", "fundedAt": fundedAt-str })))))
  (defun mark-paid (id)
    (let ((now (at "block-time" (chain-data)))
          (t2 (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state: must be FUNDED")
        (enforce
          (or (= (length fundedAt) 0)
              (<= now (add-time (time fundedAt) t2)))
          "Mark-paid period expired (T2) - seller can call timeout-funded-refund")
        (enforce
          (or (and (= side "SELL") (= b (at "sender" (chain-data))))
              (and (= side "BUY") (= c (at "sender" (chain-data)))))
          "Only fiat payer can mark paid")
        (let ((paidAt-str (format-time "%Y-%m-%dT%H:%M:%SZ" (at "block-time" (chain-data)))))
          (update escrows id { "state": "PAID", "paidAt": paidAt-str })))))
  (defun release (offerId:string)
    (let ((id offerId)
          (now (at "block-time" (chain-data)))
          (t3 (get-t3)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (contains s ["PAID" "DISPUTED"]) "Invalid state for release")
        (if (= s "DISPUTED")
          true
          (enforce
            (or (= (length paidAt) 0)
                (<= now (add-time (time paidAt) t3)))
            "Release period expired (T3) - call timeout-paid-dispute"))
        (enforce
          (or (= (at "sender" (chain-data)) a)
              (or (and (= s "PAID") (and (= side "SELL") (= (at "sender" (chain-data)) c)))
                  (and (= s "PAID") (and (= side "BUY") (= (at "sender" (chain-data)) b)))))
          "Only KDA holder or arbiter can release - DISPUTED only arbiter")
        (let ((recipient (if (= side "SELL") b c))
              (seller (if (= side "SELL") c b))
              (vault (concat [VAULT_ACCOUNT id])))
          (with-capability (ESCROW_VAULT_DEBIT id recipient amt)
            (if (= side "SELL")
              (coin.transfer vault b amt)
              (coin.transfer vault c amt)))
          (update escrows id { "state": "COMPLETED" })
          (inc-reputation seller true)
          (inc-reputation recipient true)))))
  (defun refund (offerId:string)
    (let ((id offerId))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side }
        (enforce (contains s ["PAID" "FUNDED" "DISPUTED"]) "Invalid state for refund")
        (enforce (= (at "sender" (chain-data)) a) "Only arbiter can refund")
        (let ((refund-to (if (= side "SELL") c b))
              (other (if (= side "SELL") b c))
              (vault (concat [VAULT_ACCOUNT id])))
          (with-capability (ESCROW_VAULT_DEBIT id refund-to amt)
            (coin.transfer vault refund-to amt))
          (update escrows id { "buyer": "", "state": "REFUNDED" })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))
  (defun timeout-accepted-close (id)
    (let ((now (at "block-time" (chain-data)))
          (t1 (get-t1)))
      (with-read escrows id { "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce (> (length acceptedAt) 0) "Missing acceptedAt")
        (enforce (> now (add-time (time acceptedAt) t1)) "Funding period not yet expired")
        (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": "" }))))
  (defun timeout-funded-refund (id)
    (let ((now (at "block-time" (chain-data)))
          (t2 (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := amt, "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state")
        (enforce (> (length fundedAt) 0) "Missing fundedAt")
        (enforce (> now (add-time (time fundedAt) t2)) "Mark-paid period not yet expired")
        (enforce
          (or (and (= side "SELL") (= (at "sender" (chain-data)) c))
              (and (= side "BUY") (= (at "sender" (chain-data)) b)))
          "Only seller can timeout-refund")
        (let ((refund-to (if (= side "SELL") c b))
              (other (if (= side "SELL") b c))
              (vault (concat [VAULT_ACCOUNT id])))
          (with-capability (ESCROW_VAULT_DEBIT id refund-to amt)
            (coin.transfer vault refund-to amt))
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": "" })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))
  (defun timeout-paid-dispute (id)
    (let ((now (at "block-time" (chain-data)))
          (t3 (get-t3)))
      (with-read escrows id { "creator" := c, "buyer" := b, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (= s "PAID") "Invalid state")
        (enforce (> (length paidAt) 0) "Missing paidAt")
        (enforce (> now (add-time (time paidAt) t3)) "Release period not yet expired")
        (enforce (or (and (= side "SELL") (= (at "sender" (chain-data)) b))
                     (and (= side "BUY") (= (at "sender" (chain-data)) c)))
                 "Only fiat payer can dispute")
        (update escrows id { "state": "DISPUTED" }))))
  (defun get-escrow (id)
    (read escrows id))
  ;; Exclude DELETED so list-escrow-ids matches frontend (avoids "fn" which resolves as free.fn on Chainweb).
  (defun list-escrow-ids-step (k acc)
    (with-read escrows k { "state" := s } (if (= s "DELETED") acc (concat acc [k]))))
  (defun list-escrow-ids ()
    (fold list-escrow-ids-step (keys escrows) []))
)