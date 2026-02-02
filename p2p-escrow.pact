(namespace "free")

(module p2p-escrow GOVERNANCE
  (defcap GOVERNANCE () true)
  ;; coin is in the root namespace; use coin.transfer (no 'use' to avoid
  ;; "Module coin not found" in validators that lack root; on-chain it resolves)

  (defconst VAULT_ACCOUNT "p2p-escrow-vault")
  ;; Set to your platform arbiter account (k:...) before deployment
  (defconst PLATFORM_ARBITER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")
  ;; Timed steps (Binance P2P): time limits in seconds. Each step = 10 minutes.
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
    price:decimal
    minAmount:decimal
    maxAmount:decimal
    paymentMethod:string
    fiatCurrency:string
    acceptedAt:string
    fundedAt:string
    paidAt:string)

  (deftable escrows:{escrow})

  ;; NOTE: create-table must run at TOP LEVEL (outside the module). Run once after deploy:
  ;;   (create-table free.p2p-escrow.escrows)
  ;; Use the "Initialize" button in Manage Escrow, or add that to your deployment tx.

  ;; ------------------------------------------------------------
  ;; Create offer (Binance P2P style: side, price, limits, payment method)
  ;; SELL: creator = seller (has KDA); accepter = buyer.
  ;; BUY:  creator = buyer (wants KDA); accepter = seller (has KDA).
  ;; side: "BUY" or "SELL"
  ;; price: price per KDA in fiat currency
  ;; minAmount/maxAmount: transaction limits in KDA
  ;; paymentMethod: JSON string array of payment methods (e.g. ["USDT","USDC"])
  ;; fiatCurrency: fiat currency code (e.g. "USD", "EUR")
  ;; ------------------------------------------------------------
  (defun create-offer (id creator amount side price minAmount maxAmount paymentMethod fiatCurrency)
    (enforce (= (read-msg "sender") creator) "Creator must be the transaction sender")
    (enforce
      (not (try false (read escrows id)))
      "Escrow exists")
    (enforce (> amount 0.0) "Amount must be > 0")
    (enforce (> (length creator) 0) "Creator required")
    (enforce (!= creator PLATFORM_ARBITER) "Creator and arbiter must be different")
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
      , "arbiter": PLATFORM_ARBITER
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
      , "paidAt": "" }))

  ;; ------------------------------------------------------------
  ;; Accept offer
  ;; SELL: buyer accepts (caller becomes buyer).
  ;; BUY:  seller accepts (caller becomes buyer field = KDA holder).
  ;; ------------------------------------------------------------
  (defun accept-offer (id)
    (let ((accepter (read-msg "sender"))
          (now (at "block-time" (chain-data))))
      (with-read escrows id { "creator" := c, "state" := s }
        (enforce (= s "CREATED") "Invalid state")
        (enforce (!= accepter c) "Cannot accept your own offer")
        (update escrows id { "buyer": accepter, "state": "ACCEPTED", "acceptedAt": now }))))

  ;; ------------------------------------------------------------
  ;; Deposit (KDA holder locks KDA in vault)
  ;; SELL: creator = seller (KDA holder) deposits.
  ;; BUY:  buyer field = seller (KDA holder) deposits.
  ;; Uses transfer-create so the vault is created on first deposit.
  ;; Message must contain "vault-guard" keyset (e.g. keys:[], pred:"keys-all").
  ;; ------------------------------------------------------------
  (defun deposit (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id
        { "creator" := c
        , "buyer" := b
        , "amount" := a
        , "state" := s
        , "side" := side
        , "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce
          (or (= (length acceptedAt) 0)
              (<= now (add-time (time acceptedAt) T1_SECONDS)))
          "Funding period expired (T1); trade can be closed via timeout-accepted-close")
        (enforce
          (or (and (= side "SELL") (= c (read-msg "sender")))
              (and (= side "BUY") (= b (read-msg "sender"))))
          "Only KDA holder can deposit (SELL=creator, BUY=buyer field)")
        (let ((depositor (if (= side "SELL") c b))
              (fundedAt (at "block-time" (chain-data))))
          (coin.transfer-create depositor VAULT_ACCOUNT (read-keyset "vault-guard") a)
          (update escrows id { "state": "FUNDED", "fundedAt": fundedAt })))))

  ;; ------------------------------------------------------------
  ;; Mark paid (fiat payer confirms off-chain payment)
  ;; SELL: buyer field = fiat payer.
  ;; BUY:  creator = fiat payer.
  ;; ------------------------------------------------------------
  (defun mark-paid (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id
        { "creator" := c
        , "buyer" := b
        , "state" := s
        , "side" := side
        , "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state")
        (enforce
          (or (= (length fundedAt) 0)
              (<= now (add-time (time fundedAt) T2_SECONDS)))
          "Mark-paid period expired (T2); seller can refund via timeout-funded-refund")
        (enforce
          (or (and (= side "SELL") (= b (read-msg "sender")))
              (and (= side "BUY") (= c (read-msg "sender"))))
          "Only fiat payer can mark paid (SELL=buyer field, BUY=creator)")
        (let ((paidAt (at "block-time" (chain-data))))
          (update escrows id { "state": "PAID", "paidAt": paidAt })))))

  ;; ------------------------------------------------------------
  ;; Release (KDA holder or arbiter sends KDA from vault to fiat payer)
  ;; SELL: release to buyer (b). Only creator (seller) or arbiter.
  ;; BUY:  release to creator (buyer in trade). Only buyer field (seller) or arbiter.
  ;; ------------------------------------------------------------
  (defun release (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id
        { "creator" := c
        , "buyer" := b
        , "arbiter" := a
        , "amount" := amt
        , "state" := s
        , "side" := side
        , "paidAt" := paidAt }
        (enforce (or (= s "PAID") (= s "DISPUTED")) "Invalid state for release")
        (enforce
          (or (= s "DISPUTED")
              (= (length paidAt) 0)
              (<= now (add-time (time paidAt) T3_SECONDS)))
          "Release period expired (T3); trade moved to dispute via timeout-paid-dispute")
        (enforce
          (or (= (read-msg "sender") a)
              (and (= s "PAID") (= side "SELL") (= (read-msg "sender") c))
              (and (= s "PAID") (= side "BUY") (= (read-msg "sender") b)))
          "Only KDA holder or arbiter can release; when DISPUTED only arbiter")
        (if (= side "SELL")
          (coin.transfer VAULT_ACCOUNT b amt)
          (coin.transfer VAULT_ACCOUNT c amt))
        (update escrows id { "state": "COMPLETED" }))))

  ;; ------------------------------------------------------------
  ;; Refund (arbiter returns KDA to depositor)
  ;; SELL: refund to creator (seller).
  ;; BUY:  refund to buyer field (seller in trade).
  ;; ------------------------------------------------------------
  (defun refund (id)
    (with-read escrows id
      { "creator" := c
      , "buyer" := b
      , "arbiter" := a
      , "amount" := amt
      , "state" := s
      , "side" := side }
      (enforce (or (= s "PAID") (= s "FUNDED") (= s "DISPUTED")) "Invalid state for refund")
      (enforce (= (read-msg "sender") a) "Only arbiter")
      (let ((refund-to (if (= side "SELL") c b)))
        (coin.transfer VAULT_ACCOUNT refund-to amt)
        (update escrows id { "buyer": "", "state": "REFUNDED" }))))

  ;; ------------------------------------------------------------
  ;; Close offer (creator marks offer closed in CREATED state only)
  ;; SELL: creator = seller. BUY: creator = buyer. Only creator can close.
  ;; ------------------------------------------------------------
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (read-msg "sender") c) "Only creator can close")
      (update escrows id { "state": "CLOSED" })))

  ;; ------------------------------------------------------------
  ;; Timeout: ACCEPTED -> CLOSED (seller did not fund within T1). Anyone can call.
  ;; ------------------------------------------------------------
  (defun timeout-accepted-close (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id { "state" := s, "acceptedAt" := acceptedAt }
        (enforce (= s "ACCEPTED") "Invalid state")
        (enforce (> (length acceptedAt) 0) "Missing acceptedAt")
        (enforce
          (> now (add-time (time acceptedAt) T1_SECONDS))
          "Funding period not yet expired")
        (update escrows id { "state": "CLOSED", "buyer": "", "acceptedAt": "" }))))

  ;; ------------------------------------------------------------
  ;; Timeout: FUNDED -> REFUNDED (buyer did not mark paid within T2). Seller calls.
  ;; ------------------------------------------------------------
  (defun timeout-funded-refund (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id
        { "creator" := c
        , "buyer" := b
        , "amount" := amt
        , "state" := s
        , "side" := side
        , "fundedAt" := fundedAt }
        (enforce (= s "FUNDED") "Invalid state")
        (enforce (> (length fundedAt) 0) "Missing fundedAt")
        (enforce
          (> now (add-time (time fundedAt) T2_SECONDS))
          "Mark-paid period not yet expired")
        (enforce
          (or (and (= side "SELL") (= (read-msg "sender") c))
              (and (= side "BUY") (= (read-msg "sender") b)))
          "Only seller (KDA holder) can timeout-refund")
        (let ((refund-to (if (= side "SELL") c b)))
          (coin.transfer VAULT_ACCOUNT refund-to amt)
          (update escrows id { "state": "REFUNDED", "buyer": "", "fundedAt": "" })))))

  ;; ------------------------------------------------------------
  ;; Timeout: PAID -> DISPUTED (seller did not release within T3). Anyone can call.
  ;; ------------------------------------------------------------
  (defun timeout-paid-dispute (id)
    (let ((now (time (at "block-time" (chain-data)))))
      (with-read escrows id { "state" := s, "paidAt" := paidAt }
        (enforce (= s "PAID") "Invalid state")
        (enforce (> (length paidAt) 0) "Missing paidAt")
        (enforce
          (> now (add-time (time paidAt) T3_SECONDS))
          "Release period not yet expired")
        (update escrows id { "state": "DISPUTED" }))))

  (defun get-escrow (id)
    (read escrows id))

  ;; Returns all offer IDs in the escrows table (for listing in Manage Escrow)
  (defun list-escrow-ids ()
    (keys escrows))
)
