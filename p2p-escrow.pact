;; =============================================================================
;; CHAINWEAVER DEPLOY (copy-paste this entire file)
;; =============================================================================
;; 1. Set DEPLOYER below to your k: account (the only key that can upgrade/govern).
;; 2. Paste this file into Chainweaver; set Network, Chain, and Sender = DEPLOYER.
;; 3. Sign and grant free.p2p-escrow7.GOVERNANCE. Set Sender in Chainweaver = DEPLOYER (no Data needed).
;; 4. For upgrades (tables exist): delete or comment out the init block at the end.
;; =============================================================================
(namespace "free")

(module p2p-escrow7 GOVERNANCE
  ;; Only this account can grant GOVERNANCE (upgrade module, init, set-config).
  ;; Set to your k: account and use it as Sender in Chainweaver when deploying.
  (defconst DEPLOYER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")
  (defcap GOVERNANCE ()
    (enforce (= (at "sender" (chain-data)) DEPLOYER) "Only deployer can grant GOVERNANCE"))
  (defconst VAULT_ACCOUNT "p2p-escrow-vault-")
  ;; Vault name: VAULT_ACCOUNT + id. Static name so depositor can sign (coin.TRANSFER depositor vault amount).
  (defcap ESCROW_VAULT_DEBIT (id:string) true)
  (defun require-ESCROW_VAULT_DEBIT (id:string) (require-capability (ESCROW_VAULT_DEBIT id)))
  (defun create-escrow-vault-guard (id:string) (create-user-guard (require-ESCROW_VAULT_DEBIT id)))
  (defconst PLATFORM_ARBITER "k:f5cb898c1a34680787a0ec35ae01a45bd0e9526c010362730162c9e93a9e3436")
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
  ;; Tables must be created at TRANSACTION top level (create-table cannot be used inside module). Use the block at end of this file on first deploy.
  ;; init-all: insert config only (same as init-config). Table creation is done by the top-level block after the module.
  (defun init-all ()
    (with-capability (GOVERNANCE)
      (insert config "global"
        { "arbiter": PLATFORM_ARBITER, "t1": T1_SECONDS, "t2": T2_SECONDS, "t3": T3_SECONDS })))
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
          (coin.transfer-create depositor vault (create-escrow-vault-guard id) a)
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
  (defun release (offerId:string _sender:string)
    ;; Two args: some nodes/wallets append payload or sender as 2nd arg; we ignore _sender and use (chain-data) for auth.
    (let ((id offerId)
          (now (at "block-time" (chain-data)))
          (t3 (get-t3)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (or (= s "PAID") (= s "DISPUTED")) "Invalid state for release")
        (if (= s "DISPUTED")
          true
          (enforce
            (or (= (length paidAt) 0)
                (<= now (add-time (time paidAt) t3)))
            "Release period expired (T3) - call timeout-paid-dispute"))
        (enforce
          (or (= (at "sender" (chain-data)) a)
              (and (= s "PAID") (= side "SELL") (= (at "sender" (chain-data)) c))
              (and (= s "PAID") (= side "BUY") (= (at "sender" (chain-data)) b)))
          "Only KDA holder or arbiter can release - DISPUTED only arbiter")
        (let ((recipient (if (= side "SELL") b c))
              (seller (if (= side "SELL") c b))
              (vault (concat [VAULT_ACCOUNT id])))
          (with-capability (ESCROW_VAULT_DEBIT id)
            (if (= side "SELL")
              (coin.transfer vault b amt)
              (coin.transfer vault c amt)))
          (update escrows id { "state": "COMPLETED" })
          (inc-reputation seller true)
          (inc-reputation recipient true)))))
  ;; Refund: two args so node/wallet appending sender does not cause "too many arguments".
  (defun refund (offerId:string _sender:string)
    (let ((id offerId))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side }
        (enforce (or (= s "PAID") (= s "FUNDED") (= s "DISPUTED")) "Invalid state for refund")
        (enforce (= (at "sender" (chain-data)) a) "Only arbiter can refund")
        (let ((refund-to (if (= side "SELL") c b))
              (other (if (= side "SELL") b c))
              (vault (concat [VAULT_ACCOUNT id])))
          (with-capability (ESCROW_VAULT_DEBIT id)
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
          (with-capability (ESCROW_VAULT_DEBIT id)
            (coin.transfer vault refund-to amt))
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": "" })
          (inc-reputation refund-to false)
          (if (> (length other) 0) (inc-reputation other false) true)))))
  (defun timeout-paid-dispute (id)
    (let ((now (at "block-time" (chain-data)))
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
;; ========== INIT (run in same tx as deploy) ==========
;; When signing, grant free.p2p-escrow7.GOVERNANCE. Sender must = DEPLOYER in the module.
;; For upgrades (tables exist), comment out or delete the block below.
(with-capability (free.p2p-escrow7.GOVERNANCE)
  (create-table free.p2p-escrow7.escrows)
  (create-table free.p2p-escrow7.reputation)
  (create-table free.p2p-escrow7.config)
  (free.p2p-escrow7.init-config))
