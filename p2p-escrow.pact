(namespace "free")

(module p2p-escrow GOVERNANCE
  (defcap GOVERNANCE () true)
  ;; coin is in the root namespace; on-chain it resolves

  (defconst VAULT_ACCOUNT "p2p-escrow-vault")
  (defconst PLATFORM_ARBITER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")
  (defconst T1_SECONDS 600)
  (defconst T2_SECONDS 600)
  (defconst T3_SECONDS 600)

  ;; ---------------------------------------------------------------------------
  ;; STATE MACHINE (strict)
  ;; Valid states: CREATED | ACCEPTED | FUNDED | PAID | COMPLETED | REFUNDED | CLOSED | DISPUTED
  ;; Valid transitions:
  ;;   CREATED -> ACCEPTED (accept-offer) | CLOSED (close-offer)
  ;;   ACCEPTED -> FUNDED (deposit) | CLOSED (timeout-accepted-close)
  ;;   FUNDED -> PAID (mark-paid) | REFUNDED (refund | timeout-funded-refund)
  ;;   PAID -> COMPLETED (release) | REFUNDED (refund) | DISPUTED (timeout-paid-dispute)
  ;;   DISPUTED -> COMPLETED (release by arbiter) | REFUNDED (refund by arbiter)
  ;; Terminal: COMPLETED, REFUNDED, CLOSED
  ;; ---------------------------------------------------------------------------

  (defschema escrow
    creator:string
    buyer:string
    arbiter:string
    amount:decimal
    state:string
    side:string
    price:decimal
    minAmount:decimal
    maxAmount:decimal
    paymentMethod:string
    fiatCurrency:string
    acceptedAt:string
    fundedAt:string
    paidAt:string)

  (defschema event
    offerId:string
    eventType:string
    fromState:string
    toState:string
    actor:string
    blockTime:string)

  (defschema completed-trade
    buyer:string
    seller:string
    completedAt:string)

  (defschema config-row
    arbiter:string
    t1:integer
    t2:integer
    t3:integer)

  (deftable escrows:{escrow})
  (deftable events:{event})
  (deftable completed-trades:{completed-trade})
  (deftable config:{config-row})

  ;; Optional: index offerId -> list of event tx-hash for UI polling
  (defschema offer-events-index
    ids:[string])

  (deftable offer-event-ids:{offer-events-index})

  ;; NOTE: After deploy, run once (with GOVERNANCE):
  ;;   (create-table free.p2p-escrow.escrows)
  ;;   (create-table free.p2p-escrow.events)
  ;;   (create-table free.p2p-escrow.completed-trades)
  ;;   (create-table free.p2p-escrow.config)
  ;;   (create-table free.p2p-escrow.offer-event-ids)
  ;;   (free.p2p-escrow.init-config)

  ;; ---------------------------------------------------------------------------
  ;; Admin / config (source of truth for arbiter and timeouts; fallback to constants)
  ;; ---------------------------------------------------------------------------
  (defun init-config ()
    (with-capability (GOVERNANCE)
      (insert config "global"
        { "arbiter": PLATFORM_ARBITER
        , "t1": T1_SECONDS
        , "t2": T2_SECONDS
        , "t3": T3_SECONDS })))

  (defun set-config (arbiter t1 t2 t3)
    (with-capability (GOVERNANCE)
      (enforce (> (length arbiter) 0) "Arbiter required")
      (enforce (> t1 0) "T1 must be > 0")
      (enforce (> t2 0) "T2 must be > 0")
      (enforce (> t3 0) "T3 must be > 0")
      (write config "global" { "arbiter": arbiter, "t1": t1, "t2": t2, "t3": t3 })))

  (defun get-arbiter ()
    (let ((r (try (read config "global") (const null))))
      (if (and r (> (length (at "arbiter" r)) 0))
        (at "arbiter" r)
        PLATFORM_ARBITER)))

  (defun get-t1 () (let ((r (try (read config "global") (const null)))) (if r (at "t1" r) T1_SECONDS)))
  (defun get-t2 () (let ((r (try (read config "global") (const null)))) (if r (at "t2" r) T2_SECONDS)))
  (defun get-t3 () (let ((r (try (read config "global") (const null)))) (if r (at "t3" r) T3_SECONDS)))

  ;; ---------------------------------------------------------------------------
  ;; Events (for UI / logs)
  ;; ---------------------------------------------------------------------------
  (defun emit-event (id eventType fromState toState actor)
    (let ((txh (tx-hash))
          (blockTime (at "block-time" (chain-data))))
      (insert events txh
        { "offerId": id
        , "eventType": eventType
        , "fromState": fromState
        , "toState": toState
        , "actor": actor
        , "blockTime": blockTime })
      (let ((existing (try (read offer-event-ids id) (const { "ids": [] })))
            (ids (at "ids" existing)))
        (write offer-event-ids id { "ids": (cons txh ids) }))))

  (defun get-event (txHash)
    (read events txHash))

  (defun get-event-ids-for-offer (id)
    (let ((row (try (read offer-event-ids id) (const { "ids": [] }))))
      (at "ids" row)))

  ;; ---------------------------------------------------------------------------
  ;; Create offer
  ;; ---------------------------------------------------------------------------
  (defun create-offer (id creator amount side price minAmount maxAmount paymentMethod fiatCurrency)
    (enforce (= (read-msg "sender") creator) "Creator must be the transaction sender")
    (enforce (not (try false (read escrows id))) "Escrow exists")
    (enforce (> amount 0.0) "Amount must be > 0")
    (enforce (> (length creator) 0) "Creator required")
    (enforce (!= creator (get-arbiter)) "Creator and arbiter must be different")
    (enforce (or (= side "BUY") (= side "SELL")) "Side must be BUY or SELL")
    (enforce (> price 0.0) "Price must be > 0")
    (enforce (> minAmount 0.0) "Min amount must be > 0")
    (enforce (>= maxAmount minAmount) "Max amount must be >= min amount")
    (enforce (>= amount minAmount) "Amount must be >= min amount")
    (enforce (<= amount maxAmount) "Amount must be <= max amount")
    (enforce (> (length paymentMethod) 0) "Payment method required")
    (enforce (> (length fiatCurrency) 0) "Fiat currency required")
    (insert escrows id
      { "creator": creator
      , "buyer": ""
      , "arbiter": (get-arbiter)
      , "amount": amount
      , "state": "CREATED"
      , "side": side
      , "price": price
      , "minAmount": minAmount
      , "maxAmount": maxAmount
      , "paymentMethod": paymentMethod
      , "fiatCurrency": fiatCurrency
      , "acceptedAt": ""
      , "fundedAt": ""
      , "paidAt": "" })
    (emit-event id "CREATED" "" "CREATED" creator))

  ;; ---------------------------------------------------------------------------
  ;; Accept offer (CREATED -> ACCEPTED)
  ;; ---------------------------------------------------------------------------
  (defun accept-offer (id)
    (let ((accepter (read-msg "sender"))
          (now (at "block-time" (chain-data))))
      (with-read escrows id { "creator" := c, "state" := s }
        (enforce (= s "CREATED") "Invalid state: must be CREATED")
        (enforce (!= accepter c) "Cannot accept your own offer")
        (update escrows id { "buyer": accepter, "state": "ACCEPTED", "acceptedAt": now })
        (emit-event id "ACCEPTED" "CREATED" "ACCEPTED" accepter))))

  ;; ---------------------------------------------------------------------------
  ;; Deposit (ACCEPTED -> FUNDED); timed T1
  ;; ---------------------------------------------------------------------------
  (defun deposit (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t1 (get-t1)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "amount" := a, "state" := s, "side" := side, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state: must be ACCEPTED")
        (enforce
          (or (= (length acceptedAt) 0)
              (<= now (add-time (time acceptedAt) t1)))
          "Funding period expired (T1); call timeout-accepted-close")
        (enforce
          (or (and (= side "SELL") (= c (read-msg "sender")))
              (and (= side "BUY") (= b (read-msg "sender"))))
          "Only KDA holder can deposit")
        (let ((depositor (if (= side "SELL") c b))
              (fundedAt (at "block-time" (chain-data))))
          (coin.transfer-create depositor VAULT_ACCOUNT (read-keyset "vault-guard") a)
          (update escrows id { "state": "FUNDED", "fundedAt": fundedAt })
          (emit-event id "FUNDED" "ACCEPTED" "FUNDED" (read-msg "sender"))))))

  ;; ---------------------------------------------------------------------------
  ;; Mark paid (FUNDED -> PAID); timed T2
  ;; ---------------------------------------------------------------------------
  (defun mark-paid (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t2 (get-t2)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "state" := s, "side" := side, "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state: must be FUNDED")
        (enforce
          (or (= (length fundedAt) 0)
              (<= now (add-time (time fundedAt) t2)))
          "Mark-paid period expired (T2); seller can call timeout-funded-refund")
        (enforce
          (or (and (= side "SELL") (= b (read-msg "sender")))
              (and (= side "BUY") (= c (read-msg "sender"))))
          "Only fiat payer can mark paid")
        (let ((paidAt (at "block-time" (chain-data))))
          (update escrows id { "state": "PAID", "paidAt": paidAt })
          (emit-event id "PAID" "FUNDED" "PAID" (read-msg "sender"))))))

  ;; ---------------------------------------------------------------------------
  ;; Release (PAID | DISPUTED -> COMPLETED); timed T3 when PAID
  ;; ---------------------------------------------------------------------------
  (defun release (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t3 (get-t3)))
      (with-read escrows id
        { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt
        , "state" := s, "side" := side, "paidAt" := paidAt }
        (enforce (or (= s "PAID") (= s "DISPUTED")) "Invalid state for release")
        (enforce
          (or (= s "DISPUTED")
              (= (length paidAt) 0)
              (<= now (add-time (time paidAt) t3)))
          "Release period expired (T3); call timeout-paid-dispute")
        (enforce
          (or (= (read-msg "sender") a)
              (and (= s "PAID") (= side "SELL") (= (read-msg "sender") c))
              (and (= s "PAID") (= side "BUY") (= (read-msg "sender") b)))
          "Only KDA holder or arbiter can release; DISPUTED only arbiter")
        (if (= side "SELL")
          (coin.transfer VAULT_ACCOUNT b amt)
          (coin.transfer VAULT_ACCOUNT c amt))
        (let ((recipient (if (= side "SELL") b c))
              (seller (if (= side "SELL") c b))
              (completedAt (at "block-time" (chain-data))))
          (update escrows id { "state": "COMPLETED" })
          (insert completed-trades id { "buyer": recipient, "seller": seller, "completedAt": completedAt })
          (emit-event id "COMPLETED" s "COMPLETED" (read-msg "sender"))))))

  ;; ---------------------------------------------------------------------------
  ;; Refund (FUNDED | PAID | DISPUTED -> REFUNDED); arbiter only
  ;; ---------------------------------------------------------------------------
  (defun refund (id)
    (with-read escrows id
      { "creator" := c, "buyer" := b, "arbiter" := a, "amount" := amt, "state" := s, "side" := side }
      (enforce (or (= s "PAID") (= s "FUNDED") (= s "DISPUTED")) "Invalid state for refund")
      (enforce (= (read-msg "sender") a) "Only arbiter can refund")
      (let ((refund-to (if (= side "SELL") c b)))
        (coin.transfer VAULT_ACCOUNT refund-to amt)
        (update escrows id { "buyer": "", "state": "REFUNDED" })
        (emit-event id "REFUNDED" s "REFUNDED" a))))

  ;; ---------------------------------------------------------------------------
  ;; Close offer (CREATED -> CLOSED)
  ;; ---------------------------------------------------------------------------
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (read-msg "sender") c) "Only creator can close")
      (update escrows id { "state": "CLOSED" })
      (emit-event id "CLOSED" "CREATED" "CLOSED" c)))

  ;; ---------------------------------------------------------------------------
  ;; Timeout: ACCEPTED -> CLOSED (T1 expired); anyone
  ;; ---------------------------------------------------------------------------
  (defun timeout-accepted-close (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t1 (get-t1)))
      (with-read escrows id { "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce (> (length acceptedAt) 0) "Missing acceptedAt")
        (enforce (> now (add-time (time acceptedAt) t1)) "Funding period not yet expired")
        (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": "" })
        (emit-event id "TIMEOUT_T1" "ACCEPTED" "CLOSED" (read-msg "sender")))))

  ;; ---------------------------------------------------------------------------
  ;; Timeout: FUNDED -> REFUNDED (T2 expired); seller only
  ;; ---------------------------------------------------------------------------
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
        (let ((refund-to (if (= side "SELL") c b)))
          (coin.transfer VAULT_ACCOUNT refund-to amt)
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": "" })
          (emit-event id "TIMEOUT_T2" "FUNDED" "REFUNDED" (read-msg "sender"))))))

  ;; ---------------------------------------------------------------------------
  ;; Timeout: PAID -> DISPUTED (T3 expired); anyone (automatic dispute escalation)
  ;; ---------------------------------------------------------------------------
  (defun timeout-paid-dispute (id)
    (let ((now (time (at "block-time" (chain-data))))
          (t3 (get-t3)))
      (with-read escrows id { "state" := s, "paidAt" := paidAt }
        (enforce (= s "PAID") "Invalid state")
        (enforce (> (length paidAt) 0) "Missing paidAt")
        (enforce (> now (add-time (time paidAt) t3)) "Release period not yet expired")
        (update escrows id { "state": "DISPUTED" })
        (emit-event id "TIMEOUT_T3" "PAID" "DISPUTED" (read-msg "sender")))))

  ;; ---------------------------------------------------------------------------
  ;; Read-only
  ;; ---------------------------------------------------------------------------
  (defun get-escrow (id)
    (read escrows id))

  (defun list-escrow-ids ()
    (keys escrows))

  ;; Rating enforcement: only completed trades can be rated (backend/UI checks this)
  (defun get-completed-trade (offerId)
    (read completed-trades offerId))

  (defun list-completed-offer-ids ()
    (keys completed-trades))

  ;; Events for UI: get event by tx-hash
  (defun get-event-by-tx (txHash)
    (read events txHash))
)
