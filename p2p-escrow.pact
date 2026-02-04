(namespace "free")

(module p2p-escrow-test GOVERNANCE
  (defcap GOVERNANCE () true)
  (defconst VAULT_ACCOUNT "p2p-escrow-vault")
  (defconst PLATFORM_ARBITER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")
  (defconst T1_SECONDS 600)
  (defconst T2_SECONDS 600)
  (defconst T3_SECONDS 600)
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
    (let ((row (if (contains wallet (keys reputation)) (read reputation wallet) {"totalTrades": 0, "successfulTrades": 0, "disputesCount": 0}))
          (total (at "totalTrades" row))
          (ok (at "successfulTrades" row))
          (disputes (at "disputesCount" row)))
      (write reputation wallet
        {"totalTrades": (+ total 1), "successfulTrades": (if success (+ ok 1) ok), "disputesCount": (if success disputes (+ disputes 1))})))
  (defun get-reputation (wallet)
    (if (contains wallet (keys reputation)) (read reputation wallet) {"totalTrades": 0, "successfulTrades": 0, "disputesCount": 0}))
  (defun create-offer (id creator amount side)
    (enforce (= (read-msg "sender") creator) "Creator must be the transaction sender")
    (enforce (not (contains id (keys escrows))) "Escrow exists")
    (enforce (> amount 0.0) "Amount must be > 0")
    (enforce (> (length creator) 0) "Creator required")
    (enforce (!= creator (get-arbiter)) "Creator and arbiter must be different")
    (enforce (or (= side "BUY") (= side "SELL")) "Side must be BUY or SELL")
    (insert escrows id
      { "creator": creator, "buyer": "", "arbiter": (get-arbiter), "amount": amount, "state": "CREATED", "side": side, "acceptedAt": "", "fundedAt": "", "paidAt": "" }))
  (defun accept-offer (id)
    (let ((accepter (read-msg "sender"))
          (now (at "block-time" (chain-data))))
      (with-read escrows id { "creator" := c, "state" := s }
        (enforce (= s "CREATED") "Invalid state: must be CREATED")
        (enforce (!= accepter c) "Cannot accept your own offer")
        (update escrows id { "buyer": accepter, "state": "ACCEPTED", "acceptedAt": now }))))
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (read-msg "sender") c) "Only creator can close")
      (update escrows id { "state": "CLOSED" })))
  (defun deposit (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t1 (get-t1)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := a, "state" := s, "side" := side, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state: must be ACCEPTED")
        (enforce
          (or (= (length acceptedAt) 0)
              (<= now (add-time (time acceptedAt) t1)))
          "Funding period expired (T1) - call timeout-accepted-close")
        (enforce
          (or (and (= side "SELL") (= c (read-msg "sender")))
              (and (= side "BUY") (= b (read-msg "sender"))))
          "Only KDA holder can deposit")
        (let ((depositor (if (= side "SELL") c b))
              (fundedAt (at "block-time" (chain-data))))
          (coin.transfer-create depositor VAULT_ACCOUNT (read-keyset "vault-guard") a)
          (update escrows id { "state": "FUNDED", "fundedAt": fundedAt })))))
  (defun mark-paid (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t2 (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state: must be FUNDED")
        (enforce
          (or (= (length fundedAt) 0)
              (<= now (add-time (time fundedAt) t2)))
          "Mark-paid period expired (T2) - seller can call timeout-funded-refund")
        (enforce
          (or (and (= side "SELL") (= b (read-msg "sender")))
              (and (= side "BUY") (= c (read-msg "sender"))))
          "Only fiat payer can mark paid")
        (let ((paidAt (at "block-time" (chain-data))))
          (update escrows id { "state": "PAID", "paidAt": paidAt })))))
  (defun release (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t3 (get-t3)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (or (= s "PAID") (= s "DISPUTED")) "Invalid state for release")
        (enforce
          (or (= s "DISPUTED")
              (= (length paidAt) 0)
              (<= now (add-time (time paidAt) t3)))
          "Release period expired (T3) - call timeout-paid-dispute")
        (enforce
          (or (= (read-msg "sender") a)
              (and (= s "PAID") (= side "SELL") (= (read-msg "sender") c))
              (and (= s "PAID") (= side "BUY") (= (read-msg "sender") b)))
          "Only KDA holder or arbiter can release - DISPUTED only arbiter")
        (let ((recipient (if (= side "SELL") b c))
              (seller (if (= side "SELL") c b)))
          (if (= side "SELL")
            (coin.transfer VAULT_ACCOUNT b amt)
            (coin.transfer VAULT_ACCOUNT c amt))
          (update escrows id { "state": "COMPLETED" })
          (inc-reputation seller true)
          (inc-reputation recipient true)))))
  (defun refund (id)
    (with-read escrows id
      { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side }
      (enforce (or (= s "PAID") (= s "FUNDED") (= s "DISPUTED")) "Invalid state for refund")
      (enforce (= (read-msg "sender") a) "Only arbiter can refund")
      (let ((refund-to (if (= side "SELL") c b))
            (other (if (= side "SELL") b c)))
        (coin.transfer VAULT_ACCOUNT refund-to amt)
        (update escrows id { "buyer": "", "state": "REFUNDED" })
        (inc-reputation refund-to false)
        (if (> (length other) 0) (inc-reputation other false) true))))
  (defun timeout-accepted-close (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t1 (get-t1)))
      (with-read escrows id { "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce (> (length acceptedAt) 0) "Missing acceptedAt")
        (enforce (> now (add-time (time acceptedAt) t1)) "Funding period not yet expired")
        (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": "" }))))
  (defun timeout-funded-refund (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t2 (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := amt, "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state")
        (enforce (> (length fundedAt) 0) "Missing fundedAt")
        (enforce (> now (add-time (time fundedAt) t2)) "Mark-paid period not yet expired")
        (enforce
          (or (and (= side "SELL") (= (read-msg "sender") c))
              (and (= side "BUY") (= (read-msg "sender") b)))
          "Only seller can timeout-refund")
        (let ((refund-to (if (= side "SELL") c b))
              (other (if (= side "SELL") b c)))
          (coin.transfer VAULT_ACCOUNT refund-to amt)
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": "" })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))
  (defun timeout-paid-dispute (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t3 (get-t3)))
      (with-read escrows id { "state" := s, "paidAt" := paidAt }
        (enforce (= s "PAID") "Invalid state")
        (enforce (> (length paidAt) 0) "Missing paidAt")
        (enforce (> now (add-time (time paidAt) t3)) "Release period not yet expired")
        (update escrows id { "state": "DISPUTED" }))))
  (defun get-escrow (id)
    (read escrows id))
  (defun list-escrow-ids ()
    (keys escrows))
)
