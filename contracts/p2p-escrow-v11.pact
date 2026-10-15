;; Kadena P2P Marketplace escrow, version 11.
;;
;; What changed from v10
;;   - An offer is a pool with a minimum and maximum per trade. Sellers lock the whole pool when
;;     posting, so a buyer's take creates a trade that is already funded: no accept step, no
;;     deposit step, no T1. Several buyers can trade against one offer at the same time.
;;   - Instant settlement for payments in a Kadena token (kb-USDC, BRO, ...): take-and-settle
;;     swaps token for KDA in one transaction.
;;   - Each offer chooses its payment window; each trade snapshots price, window, fee and agent.
;;   - Buyer cancel, expiry, top-up, withdraw, dispute with a split, agent release, pause, fee
;;     (basis points, capped at 1%, 0 at launch), and events for every step.
;;   - Reputation is kept here; the site combines it with v10 history. No dependency on v10, so
;;     the same code deploys on any chain.
;;
;; Money paths (the only places KDA moves)
;;   create-offer (SELL)  creator        -> offer vault
;;   top-up (SELL)        creator        -> offer vault
;;   withdraw (SELL)      offer vault    -> creator            (only the unsold part)
;;   close-offer (SELL)   offer vault    -> creator            (the unsold part)
;;   take (SELL)          offer vault    -> trade vault        (or straight to the taker for a giveaway)
;;   take (BUY)           taker          -> trade vault
;;   take-and-settle      offer vault    -> buyer (+ fee)      and token buyer -> seller, atomically
;;   release / resolve    trade vault    -> buyer (+ fee) and/or seller
;;   cancel / timeout     trade vault    -> offer vault (if the offer is still open) or seller
;; Every vault is a principal account guarded by a capability only this module can acquire.

(namespace 'free)

(define-keyset "free.p2p-escrow-v11-gov" (read-keyset "gov-keyset"))

(module p2p-escrow-v11 GOVERNANCE

  (defcap GOVERNANCE ()
    (enforce-guard (keyset-ref-guard "free.p2p-escrow-v11-gov")))

  ;; ---------------------------------------------------------------- constants

  (defconst EPOCH:time (time "1970-01-01T00:00:00Z"))
  (defconst FEE_MAX_BPS:integer 100)          ; the fee can never exceed 1%
  (defconst PAY_WINDOW_MIN:integer 900)       ; 15 minutes
  (defconst PAY_WINDOW_MAX:integer 86400)     ; 24 hours
  (defconst MIN_AMOUNT:decimal 0.000001)

  ;; --------------------------------------------------------------- capabilities

  ;; Proves the caller controls a k: account. Signers list (ACCOUNT_AUTH "k:...").
  (defcap ACCOUNT_AUTH (account:string)
    (enforce-guard (at "guard" (coin.details account))))

  ;; Vault guards. Only this module's functions can acquire these, so only the code below
  ;; can move KDA out of a vault.
  (defcap OFFER_VAULT (id:string) true)
  (defcap TRADE_VAULT (id:string) true)
  (defun require-OFFER_VAULT (id:string) (require-capability (OFFER_VAULT id)))
  (defun require-TRADE_VAULT (id:string) (require-capability (TRADE_VAULT id)))
  (defun offer-vault-guard:guard (id:string) (create-user-guard (require-OFFER_VAULT id)))
  (defun trade-vault-guard:guard (id:string) (create-user-guard (require-TRADE_VAULT id)))
  (defun offer-vault:string (id:string) (create-principal (offer-vault-guard id)))
  (defun trade-vault:string (id:string) (create-principal (trade-vault-guard id)))

  ;; Events, for explorers, the site's live feed and agents.
  (defcap OFFER_EVENT (id:string action:string creator:string amount:decimal) @event true)
  (defcap TRADE_EVENT (id:string offer:string state:string seller:string buyer:string amount:decimal) @event true)

  ;; ------------------------------------------------------------------ schemas

  (defschema config-row
    arbiter:string
    t-release:integer          ; seconds the seller has to release after mark-paid
    fee-bps:integer            ; platform fee in basis points, 0 = none
    fee-account:string
    paused:bool)

  (defschema offer
    creator:string
    side:string                ; SELL = creator sells KDA (pool is locked); BUY = creator buys KDA
    available:decimal          ; KDA not yet taken (SELL: sitting in the offer vault)
    locked:decimal             ; KDA in open trades of this offer
    min:decimal
    max:decimal
    price:decimal              ; per KDA, in `currency`; 0 = giveaway (SELL, no token)
    currency:string            ; "USDT", "USDC", "kb-USDC", "BRO", ...
    token:string               ; "" = paid outside Kadena; else the token module name, settled instantly
    pay-window:integer         ; seconds a buyer has to pay and mark paid
    expires-at:time            ; EPOCH = never
    agent:string               ; "" or an account allowed to release this offer's trades
    state:string               ; OPEN | CLOSED
    created-at:time
    takes:integer)

  (defschema trade
    offer:string
    seller:string              ; KDA holder
    buyer:string               ; payer
    amount:decimal             ; KDA
    price:decimal
    currency:string
    token:string
    pay-amount:decimal         ; amount * price, what the buyer owes
    fee:decimal                ; KDA kept by the platform on completion (snapshot)
    pay-window:integer
    agent:string
    state:string               ; FUNDED | PAID | DISPUTED | COMPLETED | SPLIT | REFUNDED | CANCELLED
    funded-at:time
    paid-at:time
    closed-at:time)

  (defschema reputation-row
    totalTrades:integer
    successfulTrades:integer
    disputesCount:integer
    cancelsCount:integer
    volumeKda:decimal)

  (deftable config:{config-row})
  (deftable offers:{offer})
  (deftable trades:{trade})
  (deftable reputation:{reputation-row})

  ;; --------------------------------------------------------------- governance

  (defun init-config (arbiter:string fee-account:string)
    (with-capability (GOVERNANCE)
      (enforce (> (length arbiter) 0) "Arbiter required")
      (insert config "global"
        { "arbiter": arbiter, "t-release": 3600, "fee-bps": 0, "fee-account": fee-account, "paused": false })))

  (defun set-arbiter (arbiter:string)
    (with-capability (GOVERNANCE)
      (enforce (> (length arbiter) 0) "Arbiter required")
      (update config "global" { "arbiter": arbiter })))

  (defun set-release-window (seconds:integer)
    (with-capability (GOVERNANCE)
      (enforce (and (>= seconds 900) (<= seconds 86400)) "Release window must be 15 min to 24 h")
      (update config "global" { "t-release": seconds })))

  ;; The fee applies to trades taken after the change; open trades keep their snapshot.
  (defun set-fee (bps:integer account:string)
    (with-capability (GOVERNANCE)
      (enforce (and (>= bps 0) (<= bps FEE_MAX_BPS)) "Fee must be 0 to 100 basis points")
      (enforce (or (= bps 0) (> (length account) 0)) "Fee account required")
      (update config "global" { "fee-bps": bps, "fee-account": account })))

  ;; Pause stops new offers, top-ups and takes. Releases, refunds, cancels, withdrawals and
  ;; dispute resolution keep working, so nobody's KDA can be stuck by a pause.
  (defun set-paused (paused:bool)
    (with-capability (GOVERNANCE)
      (update config "global" { "paused": paused })))

  (defun get-config () (read config "global"))
  (defun get-arbiter:string () (at "arbiter" (read config "global")))
  (defun not-paused () (enforce (not (at "paused" (read config "global"))) "Marketplace is paused"))
  (defun now:time () (at "block-time" (chain-data)))

  ;; ---------------------------------------------------------------- helpers

  (defun valid-amount (amount:decimal what:string)
    (enforce (>= amount MIN_AMOUNT) (format "{} must be at least {}" [what MIN_AMOUNT]))
    (enforce (= amount (floor amount 12)) (format "{} has more than 12 decimals" [what])))

  (defun valid-account (account:string)
    (enforce (= (take 2 account) "k:") "Only k: accounts are supported")
    (enforce (= (length account) 66) "Invalid k: account"))

  (defun valid-range (min:decimal max:decimal)
    (enforce (>= min MIN_AMOUNT) "Minimum per trade too small")
    (enforce (>= max min) "Maximum must be at least the minimum"))

  (defun valid-window (seconds:integer)
    (enforce (and (>= seconds PAY_WINDOW_MIN) (<= seconds PAY_WINDOW_MAX)) "Payment window must be 15 min to 24 h"))

  (defun fee-for:decimal (amount:decimal)
    (with-read config "global" { "fee-bps" := bps }
      (if (= bps 0) 0.0 (floor (/ (* amount bps) 10000.0) 12))))

  (defun pay-amount-for:decimal (amount:decimal price:decimal)
    (round (* amount price) 6))

  (defun bump (wallet:string success:bool dispute:bool cancel:bool volume:decimal)
    (with-default-read reputation wallet
      { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0, "cancelsCount": 0, "volumeKda": 0.0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes, "cancelsCount" := cancels, "volumeKda" := vol }
      (write reputation wallet
        { "totalTrades": (+ total 1)
        , "successfulTrades": (if success (+ ok 1) ok)
        , "disputesCount": (if dispute (+ disputes 1) disputes)
        , "cancelsCount": (if cancel (+ cancels 1) cancels)
        , "volumeKda": (+ vol volume) })))

  (defun get-reputation (wallet:string)
    (with-default-read reputation wallet
      { "totalTrades": 0, "successfulTrades": 0, "disputesCount": 0, "cancelsCount": 0, "volumeKda": 0.0 }
      { "totalTrades" := total, "successfulTrades" := ok, "disputesCount" := disputes, "cancelsCount" := cancels, "volumeKda" := vol }
      { "totalTrades": total, "successfulTrades": ok, "disputesCount": disputes, "cancelsCount": cancels, "volumeKda": vol }))

  ;; Pays `amount` KDA from a trade vault to `to`, keeping `fee` for the platform.
  (defun pay-from-trade (id:string to:string amount:decimal fee:decimal)
    (with-capability (TRADE_VAULT id)
      (with-read config "global" { "fee-account" := fee-account }
        (let ((vault (trade-vault id))
              (net   (- amount fee)))
          (if (or (= fee 0.0) (= to fee-account))
            ;; one transfer (a managed TRANSFER to the same receiver cannot be installed twice in one tx)
            (let ((x 0))
              (install-capability (coin.TRANSFER vault to amount))
              (coin.transfer vault to amount))
            (let ((x 0))
              (install-capability (coin.TRANSFER vault to net))
              (coin.transfer vault to net)
              (install-capability (coin.TRANSFER vault fee-account fee))
              (coin.transfer vault fee-account fee)))))))

  ;; Returns `amount` KDA from a trade vault to its offer's pool (if still open) or to the seller.
  (defun return-from-trade (trade-id:string offer-id:string seller:string amount:decimal)
    (with-read offers offer-id { "state" := ostate, "available" := available, "locked" := locked, "side" := side }
      (with-capability (TRADE_VAULT trade-id)
        (let ((vault (trade-vault trade-id)))
          (if (and (= ostate "OPEN") (= side "SELL"))
            (let ((pool (offer-vault offer-id)))
              (install-capability (coin.TRANSFER vault pool amount))
              (coin.transfer-create vault pool (offer-vault-guard offer-id) amount)
              (update offers offer-id { "available": (+ available amount), "locked": (- locked amount) }))
            (let ((x 0))
              (install-capability (coin.TRANSFER vault seller amount))
              (coin.transfer vault seller amount)
              (update offers offer-id { "locked": (- locked amount) })))))))

  (defun settle-locked (offer-id:string amount:decimal)
    (with-read offers offer-id { "locked" := locked }
      (update offers offer-id { "locked": (- locked amount) })))

  ;; ------------------------------------------------------------------ offers

  (defun create-offer (id:string creator:string side:string total:decimal min:decimal max:decimal
                       price:decimal currency:string token:string pay-window:integer
                       expires-at:time agent:string)
    (not-paused)
    (with-capability (ACCOUNT_AUTH creator)
      (enforce (and (> (length id) 0) (<= (length id) 128)) "Invalid offer id")
      (with-default-read offers id { "creator": "" } { "creator" := existing }
        (enforce (= (length existing) 0) "Offer exists"))
      (valid-account creator)
      (enforce (contains side ["SELL" "BUY"]) "Side must be SELL or BUY")
      (valid-amount total "Total")
      (valid-range min max)
      (enforce (<= max total) "Maximum per trade cannot exceed the total")
      (enforce (>= price 0.0) "Price cannot be negative")
      (enforce (= price (floor price 12)) "Price has more than 12 decimals")
      (enforce (> (length currency) 0) "Currency required")
      (enforce (or (> price 0.0) (and (= side "SELL") (= (length token) 0))) "A free giveaway must be a SELL offer paid outside Kadena")
      (enforce (or (= (length token) 0) (= side "SELL")) "Instant token settlement is for SELL offers")
      (valid-window pay-window)
      (enforce (or (= expires-at EPOCH) (> expires-at (now))) "Expiry must be in the future")
      (enforce (!= creator (get-arbiter)) "The arbiter cannot trade")
      (enforce (or (= (length agent) 0) (and (!= agent creator) (!= agent (get-arbiter)))) "Agent must be a different account")
      (if (= side "SELL")
        (let ((vault (offer-vault id)))
          (coin.transfer-create creator vault (offer-vault-guard id) total))
        "BUY offer: the KDA holder locks at take")
      (insert offers id
        { "creator": creator, "side": side, "available": total, "locked": 0.0, "min": min, "max": max
        , "price": price, "currency": currency, "token": token, "pay-window": pay-window
        , "expires-at": expires-at, "agent": agent, "state": "OPEN", "created-at": (now), "takes": 0 })
      (emit-event (OFFER_EVENT id "CREATED" creator total))
      id))

  (defun top-up (id:string amount:decimal)
    (not-paused)
    (with-read offers id { "creator" := creator, "side" := side, "available" := available, "state" := state, "max" := max }
      (with-capability (ACCOUNT_AUTH creator)
        (enforce (= state "OPEN") "Offer is closed")
        (valid-amount amount "Amount")
        (if (= side "SELL")
          (coin.transfer-create creator (offer-vault id) (offer-vault-guard id) amount)
          "BUY offer: nothing to lock")
        (update offers id { "available": (+ available amount) })
        (emit-event (OFFER_EVENT id "TOP_UP" creator amount))
        id)))

  ;; The unsold part can always be taken back; open trades keep their own vaults.
  (defun withdraw (id:string amount:decimal)
    (with-read offers id { "creator" := creator, "side" := side, "available" := available }
      (with-capability (ACCOUNT_AUTH creator)
        (valid-amount amount "Amount")
        (enforce (<= amount available) "More than the unsold amount")
        (if (= side "SELL")
          (with-capability (OFFER_VAULT id)
            (let ((vault (offer-vault id)))
              (install-capability (coin.TRANSFER vault creator amount))
              (coin.transfer vault creator amount)))
          "BUY offer: nothing locked")
        (update offers id { "available": (- available amount) })
        (emit-event (OFFER_EVENT id "WITHDRAW" creator amount))
        id)))

  ;; Changes apply to future takes only; open trades keep their snapshots.
  (defun update-offer (id:string min:decimal max:decimal price:decimal pay-window:integer expires-at:time agent:string)
    (with-read offers id { "creator" := creator, "state" := state, "token" := token, "side" := side }
      (with-capability (ACCOUNT_AUTH creator)
        (enforce (= state "OPEN") "Offer is closed")
        (valid-range min max)
        (enforce (>= price 0.0) "Price cannot be negative")
        (enforce (= price (floor price 12)) "Price has more than 12 decimals")
        (enforce (or (> price 0.0) (and (= side "SELL") (= (length token) 0))) "A free giveaway must be a SELL offer paid outside Kadena")
        (valid-window pay-window)
        (enforce (or (= expires-at EPOCH) (> expires-at (now))) "Expiry must be in the future")
        (enforce (or (= (length agent) 0) (and (!= agent creator) (!= agent (get-arbiter)))) "Agent must be a different account")
        (update offers id { "min": min, "max": max, "price": price, "pay-window": pay-window, "expires-at": expires-at, "agent": agent })
        (emit-event (OFFER_EVENT id "UPDATED" creator 0.0))
        id)))

  ;; Closing returns the unsold KDA. Open trades continue and settle on their own.
  (defun close-offer (id:string)
    (with-read offers id { "creator" := creator, "side" := side, "available" := available, "state" := state }
      (with-capability (ACCOUNT_AUTH creator)
        (enforce (= state "OPEN") "Offer is already closed")
        (if (and (= side "SELL") (> available 0.0))
          (with-capability (OFFER_VAULT id)
            (let ((vault (offer-vault id)))
              (install-capability (coin.TRANSFER vault creator available))
              (coin.transfer vault creator available)))
          "nothing to return")
        (update offers id { "state": "CLOSED", "available": 0.0 })
        (emit-event (OFFER_EVENT id "CLOSED" creator available))
        id)))

  ;; ------------------------------------------------------------------- takes

  (defun check-take (offer-id:string taker:string amount:decimal)
    (with-read offers offer-id
      { "creator" := creator, "state" := state, "available" := available, "min" := min, "max" := max, "expires-at" := expires-at }
      (enforce (= state "OPEN") "Offer is closed")
      (enforce (or (= expires-at EPOCH) (< (now) expires-at)) "Offer has expired")
      (enforce (!= taker creator) "Cannot take your own offer")
      (valid-account taker)
      (valid-amount amount "Amount")
      (enforce (>= amount min) "Below the minimum for this offer")
      (enforce (<= amount max) "Above the maximum for this offer")
      (enforce (<= amount available) "Not enough left in this offer")))

  (defun new-trade-id (trade-id:string)
    (enforce (and (> (length trade-id) 0) (<= (length trade-id) 128)) "Invalid trade id")
    (with-default-read trades trade-id { "offer": "" } { "offer" := existing }
      (enforce (= (length existing) 0) "Trade exists")))

  ;; Take a slice of an offer. SELL: the KDA moves from the pool to the trade's vault, so the
  ;; trade starts FUNDED (a free giveaway goes straight to the taker). BUY: the taker locks the
  ;; KDA themselves in the same transaction.
  (defun take-offer (trade-id:string offer-id:string taker:string amount:decimal)
    (not-paused)
    (new-trade-id trade-id)
    (check-take offer-id taker amount)
    (with-capability (ACCOUNT_AUTH taker)
      (with-read offers offer-id
        { "creator" := creator, "side" := side, "available" := available, "locked" := locked
        , "price" := price, "currency" := currency, "token" := token, "pay-window" := pay-window
        , "agent" := agent, "takes" := takes }
        (enforce (= (length token) 0) "This offer settles instantly: use take-and-settle")
        (let* ((sell     (= side "SELL"))
               (seller   (if sell creator taker))
               (buyer    (if sell taker creator))
               (giveaway (= price 0.0))
               (fee      (if giveaway 0.0 (fee-for amount)))
               (vault    (trade-vault trade-id)))
          (if sell
            (with-capability (OFFER_VAULT offer-id)
              (let ((pool (offer-vault offer-id)))
                (if giveaway
                  (let ((net (- amount fee)))
                    (install-capability (coin.TRANSFER pool taker net))
                    (coin.transfer pool taker net)
                    (if (> fee 0.0)
                      (with-read config "global" { "fee-account" := fee-account }
                        (install-capability (coin.TRANSFER pool fee-account fee))
                        (coin.transfer pool fee-account fee))
                      "no fee"))
                  (let ((x 0))
                    (install-capability (coin.TRANSFER pool vault amount))
                    (coin.transfer-create pool vault (trade-vault-guard trade-id) amount)))))
            (coin.transfer-create taker vault (trade-vault-guard trade-id) amount))
          (insert trades trade-id
            { "offer": offer-id, "seller": seller, "buyer": buyer, "amount": amount
            , "price": price, "currency": currency, "token": token
            , "pay-amount": (pay-amount-for amount price), "fee": fee, "pay-window": pay-window, "agent": agent
            , "state": (if giveaway "COMPLETED" "FUNDED")
            , "funded-at": (now), "paid-at": EPOCH, "closed-at": (if giveaway (now) EPOCH) })
          (update offers offer-id
            { "available": (- available amount), "locked": (if giveaway locked (+ locked amount)), "takes": (+ takes 1) })
          (if giveaway
            (let ((y 0))
              (bump seller true false false amount)
              (bump buyer true false false amount))
            "funded")
          (emit-event (TRADE_EVENT trade-id offer-id (if giveaway "COMPLETED" "FUNDED") seller buyer amount))
          trade-id))))

  ;; Instant swap: the buyer pays the token and receives the KDA in one transaction.
  ;; The buyer signs the token's TRANSFER capability (buyer -> seller, pay amount).
  (defun take-and-settle (trade-id:string offer-id:string taker:string amount:decimal token:module{fungible-v2})
    (not-paused)
    (new-trade-id trade-id)
    (check-take offer-id taker amount)
    (with-capability (ACCOUNT_AUTH taker)
      (with-read offers offer-id
        { "creator" := creator, "side" := side, "available" := available
        , "price" := price, "currency" := currency, "token" := token-name, "pay-window" := pay-window
        , "agent" := agent, "takes" := takes }
        (enforce (= side "SELL") "Instant settlement is for SELL offers")
        (enforce (> (length token-name) 0) "This offer is paid outside Kadena: use take-offer")
        (enforce (= (format "{}" [token]) token-name) "Wrong token module for this offer")
        (let* ((fee  (fee-for amount))
               (pay  (round (* amount price) (token::precision)))
               (net  (- amount fee))
               (pool (offer-vault offer-id)))
          (enforce (> pay 0.0) "Payment rounds to zero")
          ;; token: buyer -> seller
          (token::transfer taker creator pay)
          ;; KDA: pool -> buyer (and fee)
          (with-capability (OFFER_VAULT offer-id)
            (install-capability (coin.TRANSFER pool taker net))
            (coin.transfer pool taker net)
            (if (> fee 0.0)
              (with-read config "global" { "fee-account" := fee-account }
                (install-capability (coin.TRANSFER pool fee-account fee))
                (coin.transfer pool fee-account fee))
              "no fee"))
          (insert trades trade-id
            { "offer": offer-id, "seller": creator, "buyer": taker, "amount": amount
            , "price": price, "currency": currency, "token": token-name
            , "pay-amount": pay, "fee": fee, "pay-window": pay-window, "agent": agent
            , "state": "COMPLETED", "funded-at": (now), "paid-at": (now), "closed-at": (now) })
          (update offers offer-id { "available": (- available amount), "takes": (+ takes 1) })
          (bump creator true false false amount)
          (bump taker true false false amount)
          (emit-event (TRADE_EVENT trade-id offer-id "COMPLETED" creator taker amount))
          trade-id))))

  ;; ------------------------------------------------------------------- trades

  (defun mark-paid (trade-id:string)
    (with-read trades trade-id { "offer" := offer, "buyer" := buyer, "seller" := seller, "state" := state, "funded-at" := funded-at, "pay-window" := window, "amount" := amount }
      (with-capability (ACCOUNT_AUTH buyer)
        (enforce (= state "FUNDED") "Trade is not waiting for payment")
        (enforce (<= (now) (add-time funded-at window)) "Payment window has passed")
        (update trades trade-id { "state": "PAID", "paid-at": (now) })
        (emit-event (TRADE_EVENT trade-id offer "PAID" seller buyer amount))
        trade-id)))

  ;; The seller (any time while FUNDED or PAID) or the offer's agent sends the KDA to the buyer.
  ;; An agent can do nothing else: no refund, no other recipient, no other amount.
  (defun release (trade-id:string)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "fee" := fee, "state" := state, "agent" := agent }
      (enforce (contains state ["FUNDED" "PAID"]) "Trade cannot be released from this state")
      (enforce-one "Only the seller or the offer's agent can release"
        [ (with-capability (ACCOUNT_AUTH seller) true)
          (and (enforce (> (length agent) 0) "No agent") (with-capability (ACCOUNT_AUTH agent) true)) ])
      (pay-from-trade trade-id buyer amount fee)
      (settle-locked offer amount)
      (update trades trade-id { "state": "COMPLETED", "closed-at": (now) })
      (bump seller true false false amount)
      (bump buyer true false false amount)
      (emit-event (TRADE_EVENT trade-id offer "COMPLETED" seller buyer amount))
      trade-id))

  ;; The buyer backs out before paying. The KDA goes back to the pool.
  (defun cancel (trade-id:string)
    (with-read trades trade-id { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state }
      (with-capability (ACCOUNT_AUTH buyer)
        (enforce (= state "FUNDED") "Only an unpaid trade can be cancelled")
        (return-from-trade trade-id offer seller amount)
        (update trades trade-id { "state": "CANCELLED", "closed-at": (now) })
        (bump buyer false false true 0.0)
        (emit-event (TRADE_EVENT trade-id offer "CANCELLED" seller buyer amount))
        trade-id)))

  ;; The buyer never marked paid within the window: the seller takes the KDA back.
  (defun timeout-refund (trade-id:string)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state, "funded-at" := funded-at, "pay-window" := window }
      (with-capability (ACCOUNT_AUTH seller)
        (enforce (= state "FUNDED") "Trade is not waiting for payment")
        (enforce (> (now) (add-time funded-at window)) "Payment window has not passed yet")
        (return-from-trade trade-id offer seller amount)
        (update trades trade-id { "state": "REFUNDED", "closed-at": (now) })
        (bump buyer false false true 0.0)
        (emit-event (TRADE_EVENT trade-id offer "REFUNDED" seller buyer amount))
        trade-id)))

  ;; Buyer: any time before completion (for example "I paid but the seller is silent").
  ;; Seller: once the buyer claims to have paid. Either: after the release window has passed.
  (defun open-dispute (trade-id:string)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state, "paid-at" := paid-at }
      (enforce (contains state ["FUNDED" "PAID"]) "Trade cannot be disputed from this state")
      (let ((late (and (= state "PAID") (> (now) (add-time paid-at (at "t-release" (read config "global")))))))
        (enforce-one "Only the buyer, or the seller after mark-paid, can dispute"
          [ (with-capability (ACCOUNT_AUTH buyer) true)
            (and (enforce (or (= state "PAID") late) "Seller can dispute after mark-paid") (with-capability (ACCOUNT_AUTH seller) true)) ]))
      (update trades trade-id { "state": "DISPUTED" })
      (emit-event (TRADE_EVENT trade-id offer "DISPUTED" seller buyer amount))
      trade-id))

  ;; The arbiter settles a dispute: `to-buyer` KDA to the buyer, the rest back to the seller.
  ;; The arbiter has no power over a trade that is not disputed.
  (defun resolve (trade-id:string to-buyer:decimal)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "fee" := fee, "state" := state }
      (with-capability (ACCOUNT_AUTH (get-arbiter))
        (enforce (= state "DISPUTED") "Trade is not disputed")
        (enforce (and (>= to-buyer 0.0) (<= to-buyer amount)) "Split must be between 0 and the trade amount")
        (enforce (= to-buyer (floor to-buyer 12)) "Split has more than 12 decimals")
        (let* ((to-seller  (- amount to-buyer))
               (fee-part   (if (= to-buyer amount) fee (if (= to-buyer 0.0) 0.0 (floor (/ (* fee to-buyer) amount) 12))))
               (new-state  (if (= to-buyer amount) "COMPLETED" (if (= to-buyer 0.0) "REFUNDED" "SPLIT"))))
          (if (> to-buyer 0.0) (pay-from-trade trade-id buyer to-buyer fee-part) "nothing to buyer")
          (if (> to-seller 0.0)
            (with-capability (TRADE_VAULT trade-id)
              (let ((vault (trade-vault trade-id)))
                (install-capability (coin.TRANSFER vault seller to-seller))
                (coin.transfer vault seller to-seller)))
            "nothing to seller")
          (settle-locked offer amount)
          (update trades trade-id { "state": new-state, "closed-at": (now) })
          (bump seller false true false 0.0)
          (bump buyer false true false 0.0)
          (emit-event (TRADE_EVENT trade-id offer new-state seller buyer to-buyer))
          new-state))))

  ;; ------------------------------------------------------------------- reads

  (defun get-offer (id:string) (read offers id))
  (defun get-trade (id:string) (read trades id))
  (defun list-offer-ids ()
    (fold-db offers (lambda (k obj) (= (at "state" obj) "OPEN")) (lambda (k obj) k)))
  (defun list-trade-ids ()
    (fold-db trades (lambda (k obj) true) (lambda (k obj) k)))
  (defun list-active-trade-ids ()
    (fold-db trades (lambda (k obj) (contains (at "state" obj) ["FUNDED" "PAID" "DISPUTED"])) (lambda (k obj) k)))
)
