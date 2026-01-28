(namespace "free")

(module p2p-escrow GOVERNANCE
  (defcap GOVERNANCE () true)
  ;; coin is in the root namespace; use coin.transfer (no 'use' to avoid
  ;; "Module coin not found" in validators that lack root; on-chain it resolves)

  (defconst VAULT_ACCOUNT "p2p-escrow-vault")
  ;; Set to your platform arbiter account (k:...) before deployment
  (defconst PLATFORM_ARBITER "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e")

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
    fiatCurrency:string)

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
      , "fiatCurrency": fiatCurrency }))

  ;; ------------------------------------------------------------
  ;; Accept offer
  ;; SELL: buyer accepts (caller becomes buyer).
  ;; BUY:  seller accepts (caller becomes buyer field = KDA holder).
  ;; ------------------------------------------------------------
  (defun accept-offer (id)
    (let ((accepter (read-msg "sender")))
      (with-read escrows id { "state" := s }
        (enforce (= s "CREATED") "Invalid state")
        (update escrows id { "buyer": accepter, "state": "ACCEPTED" }))))

  ;; ------------------------------------------------------------
  ;; Deposit (KDA holder locks KDA in vault)
  ;; SELL: creator = seller (KDA holder) deposits.
  ;; BUY:  buyer field = seller (KDA holder) deposits.
  ;; Uses transfer-create so the vault is created on first deposit.
  ;; Message must contain "vault-guard" keyset (e.g. keys:[], pred:"keys-all").
  ;; ------------------------------------------------------------
  (defun deposit (id)
    (with-read escrows id
      { "creator" := c
      , "buyer" := b
      , "amount" := a
      , "state" := s
      , "side" := side }
      (enforce (= s "ACCEPTED") "Invalid state")
      (enforce
        (or (and (= side "SELL") (= c (read-msg "sender")))
            (and (= side "BUY") (= b (read-msg "sender"))))
        "Only KDA holder can deposit (SELL=creator, BUY=buyer field)")
      (let ((depositor (if (= side "SELL") c b)))
        (coin.transfer-create depositor VAULT_ACCOUNT (read-keyset "vault-guard") a)
        (update escrows id { "state": "FUNDED" }))))

  ;; ------------------------------------------------------------
  ;; Mark paid (fiat payer confirms off-chain payment)
  ;; SELL: buyer field = fiat payer.
  ;; BUY:  creator = fiat payer.
  ;; ------------------------------------------------------------
  (defun mark-paid (id)
    (with-read escrows id
      { "creator" := c
      , "buyer" := b
      , "state" := s
      , "side" := side }
      (enforce (= s "FUNDED") "Invalid state")
      (enforce
        (or (and (= side "SELL") (= b (read-msg "sender")))
            (and (= side "BUY") (= c (read-msg "sender"))))
        "Only fiat payer can mark paid (SELL=buyer field, BUY=creator)")
      (update escrows id { "state": "PAID" })))

  ;; ------------------------------------------------------------
  ;; Release (KDA holder or arbiter sends KDA from vault to fiat payer)
  ;; SELL: release to buyer (b). Only creator (seller) or arbiter.
  ;; BUY:  release to creator (buyer in trade). Only buyer field (seller) or arbiter.
  ;; ------------------------------------------------------------
  (defun release (id)
    (with-read escrows id
      { "creator" := c
      , "buyer" := b
      , "arbiter" := a
      , "amount" := amt
      , "state" := s
      , "side" := side }
      (enforce (= s "PAID") "Invalid state")
      (enforce
        (or (= (read-msg "sender") a)
            (and (= side "SELL") (= (read-msg "sender") c))
            (and (= side "BUY") (= (read-msg "sender") b)))
        "Only KDA holder or arbiter can release")
      (if (= side "SELL")
        (coin.transfer VAULT_ACCOUNT b amt)
        (coin.transfer VAULT_ACCOUNT c amt))
      (update escrows id { "state": "COMPLETED" })))

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
      (enforce (or (= s "PAID") (= s "FUNDED")) "Invalid state for refund")
      (enforce (= (read-msg "sender") a) "Only arbiter")
      (let ((refund-to (if (= side "SELL") c b)))
        (coin.transfer VAULT_ACCOUNT refund-to amt)
        (update escrows id { "buyer": "", "state": "CREATED" }))))

  ;; ------------------------------------------------------------
  ;; Close offer (creator marks offer closed in CREATED state only)
  ;; SELL: creator = seller. BUY: creator = buyer. Only creator can close.
  ;; ------------------------------------------------------------
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (read-msg "sender") c) "Only creator can close")
      (update escrows id { "state": "CLOSED" })))

  (defun get-escrow (id)
    (read escrows id))

  ;; Returns all offer IDs in the escrows table (for listing in Manage Escrow)
  (defun list-escrow-ids ()
    (keys escrows))
)
