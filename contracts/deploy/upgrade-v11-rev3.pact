;; UPGRADE of free.p2p-escrow-v11 on mainnet01 chains 1 and 2 (2026-10-22, revision 3). Same module name, same keyset,
;; same tables plus four new ones. Upgrades over revision 2 (module hash R3ER6cBjt19Xu7qTps_qP3LDQTBje4RYH22KsVE3LFc).
;; New: (1) a 30-minute grace period after the payment window: the buyer can still mark paid or dispute, the seller
;; cannot take the KDA back until it ends; (2) an approved-token list for instant swaps (governance-only), filled
;; below for the chain this runs on; (3) free takes: a new gas station module free.p2p-escrow-v11-gas pays the gas
;; of a buyer's take of a SELL pool (and their mark-paid, cancel or dispute on that trade), with daily limits set
;; by governance (and at most 3 per pool per day). The station keeps a daily payment budget (4 per free take).
;; Free takes stay OFF until set-sponsorship is run (contracts/DEPLOY-v11.md, revision 3). Also: take-and-settle
;; writes the trade and the pool before calling the token.
;; Deploy like revision 2: keyset "gov-keyset" in the data (both governance keys, keys-all), both keys signing
;; unrestricted. The same file deploys on chain 1 and chain 2.
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
  ;; After the payment window the buyer has this long to mark paid or open a dispute before the seller can take
  ;; the KDA back, so a buyer who paid but was late to tap "I paid" is not refunded away by a fast seller.
  (defconst GRACE_S:integer 1800)
  ;; Free takes of one pool per UTC day, so throwaway keys cannot lock a seller's whole pool for free.
  (defconst FREE_PER_POOL:integer 3)
  ;; The station pays a free-take trade's later steps only while they are timely: a dispute after "I paid" up to a
  ;; day past the release window, everything else within the payment window and its grace period.
  (defconst LATE_DISPUTE_S:integer 86400)

  ;; --------------------------------------------------------------- capabilities

  ;; Proves the caller controls a k: account. Signers list (ACCOUNT_AUTH "k:...").
  (defcap ACCOUNT_AUTH (account:string)
    (enforce-guard (at "guard" (coin.details account))))

  ;; Vault guards. Only this module's functions can acquire these, so only the code below
  ;; can move KDA out of a vault.
  (defcap OFFER_VAULT (id:string) true)
  (defcap TRADE_VAULT (id:string) true)
  ;; Marks a helper as module-internal: it can only run inside a public function that acquired INTERNAL.
  (defcap INTERNAL () true)
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
    paused:bool
    agent:string)              ; the platform's release agent ("" = none); the only account an offer may name as agent

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
    agent:string               ; "" or the platform's release agent (config "agent"), allowed to release this offer's trades
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

  ;; Kadena tokens an instant-swap offer may use (module name -> approved), set by governance. An offer naming any
  ;; other module cannot be created, and an existing one cannot be taken once its token is no longer approved.
  (defschema token-row approved:bool)

  ;; Free takes: the gas station account that may pay for a buyer's take (and that trade's later buyer steps), and
  ;; its limits. Key "global". No row, or station "", means no free takes.
  (defschema sponsor-row
    station:string             ; principal account of free.p2p-escrow-v11-gas
    daily:integer              ; free takes per UTC day, all buyers together
    per-buyer:integer          ; free takes per buyer per UTC day
    max-amount:decimal)        ; largest slice a free take may lock (KDA)

  (defschema count-row count:integer)          ; "day:YYYY-MM-DD" and "buyer:<account>:YYYY-MM-DD"
  (defschema sponsored-trade-row sponsored:bool)

  (deftable config:{config-row})
  (deftable offers:{offer})
  (deftable trades:{trade})
  (deftable reputation:{reputation-row})
  (deftable tokens:{token-row})
  (deftable sponsorship:{sponsor-row})
  (deftable sponsor-counts:{count-row})
  (deftable sponsored-trades:{sponsored-trade-row})

  ;; --------------------------------------------------------------- governance

  (defun init-config (arbiter:string fee-account:string)
    (with-capability (GOVERNANCE)
      (enforce (> (length arbiter) 0) "Arbiter required")
      (insert config "global"
        { "arbiter": arbiter, "t-release": 3600, "fee-bps": 0, "fee-account": fee-account, "paused": false, "agent": "" })))

  ;; The release agent: a server account that releases a trade once the payment is seen arriving (USDT/USDC).
  ;; Offers can only name this account (or none), so nobody can name an account of their own: on a BUY offer the
  ;; creator is the payer, and their own "agent" could release the seller's KDA without paying. Revoking or rotating
  ;; it takes effect at once, open trades included: an agent can only release while it is still the platform's agent
  ;; (a trade taken with an older agent is then released by its seller, or through a dispute).
  (defun set-agent (agent:string)
    (with-capability (GOVERNANCE)
      (enforce (or (= (length agent) 0) (and (= (take 2 agent) "k:") (= (length agent) 66))) "Agent must be a k: account or empty")
      (enforce (!= agent (get-arbiter)) "The agent cannot be the arbiter")
      (update config "global" { "agent": agent })))

  ;; The arbiter can be a k: account or a w: multi-signature account (for example two of three keys), which must
  ;; already exist on this chain.
  (defun set-arbiter (arbiter:string)
    (with-capability (GOVERNANCE)
      (enforce (contains (take 2 arbiter) ["k:" "w:"]) "Arbiter must be a k: or w: (multi-signature) account")
      (coin.details arbiter)
      (enforce (!= arbiter (get-agent)) "The arbiter cannot be the agent")
      (update config "global" { "arbiter": arbiter })))

  (defun set-release-window (seconds:integer)
    (with-capability (GOVERNANCE)
      (enforce (and (>= seconds 900) (<= seconds 86400)) "Release window must be 15 min to 24 h")
      (update config "global" { "t-release": seconds })))

  ;; The fee applies to trades taken after the change; open trades keep their snapshot.
  (defun set-fee (bps:integer account:string)
    (with-capability (GOVERNANCE)
      (enforce (and (>= bps 0) (<= bps FEE_MAX_BPS)) "Fee must be 0 to 100 basis points")
      (enforce (> (length account) 0) "Fee account required")
      (coin.details account) ; must exist on this chain, or every release with a fee would fail
      (update config "global" { "fee-bps": bps, "fee-account": account })))

  ;; Pause stops new offers, top-ups and takes. Releases, refunds, cancels, withdrawals and
  ;; dispute resolution keep working, so nobody's KDA can be stuck by a pause.
  (defun set-paused (paused:bool)
    (with-capability (GOVERNANCE)
      (update config "global" { "paused": paused })))

  ;; Approve (or withdraw approval of) a token module for instant swaps on this chain.
  (defun set-token (module-name:string approved:bool)
    (with-capability (GOVERNANCE)
      (enforce (> (length module-name) 0) "Token module required")
      (write tokens module-name { "approved": approved })))

  ;; Free takes. station "" turns them off. Limits keep the station's cost and any abuse small.
  (defun set-sponsorship (station:string daily:integer per-buyer:integer max-amount:decimal)
    (with-capability (GOVERNANCE)
      (enforce (or (= station "") (> (length station) 2)) "Invalid station account")
      (enforce (and (>= daily 0) (<= daily 10000)) "daily must be 0 to 10000")
      (enforce (and (>= per-buyer 0) (<= per-buyer 100)) "per-buyer must be 0 to 100")
      (enforce (>= max-amount 0.0) "max-amount must not be negative")
      (write sponsorship "global" { "station": station, "daily": daily, "per-buyer": per-buyer, "max-amount": max-amount })))

  (defun get-config () (read config "global"))
  (defun get-arbiter:string () (at "arbiter" (read config "global")))
  (defun get-agent:string () (at "agent" (read config "global")))
  (defun valid-agent (agent:string)
    (enforce (or (= (length agent) 0) (= agent (get-agent))) "Agent must be the platform's release agent or none"))
  (defun not-paused () (enforce (not (at "paused" (read config "global"))) "Marketplace is paused"))
  (defun now:time () (at "block-time" (chain-data)))
  (defun token-approved:bool (module-name:string)
    (with-default-read tokens module-name { "approved": false } { "approved" := ok } ok))
  (defun get-sponsorship ()
    (with-default-read sponsorship "global" { "station": "", "daily": 0, "per-buyer": 0, "max-amount": 0.0 }
      { "station" := s, "daily" := d, "per-buyer" := p, "max-amount" := m }
      { "station": s, "daily": d, "per-buyer": p, "max-amount": m }))
  (defun utc-day:string () (format-time "%F" (now)))
  (defun sponsor-count:integer (key:string)
    (with-default-read sponsor-counts key { "count": 0 } { "count" := c } c))
  (defun free-takes-left:object (buyer:string)
    @doc "How many free takes are left today, overall and for this buyer."
    (let ((sp (get-sponsorship)) (day (utc-day)))
      { "station": (at "station" sp), "max-amount": (at "max-amount" sp)
      , "today": (- (at "daily" sp) (sponsor-count (+ "day:" day)))
      , "buyer": (- (at "per-buyer" sp) (sponsor-count (format "buyer:{}:{}" [buyer day]))) }))
  (defun is-sponsored-trade:bool (trade-id:string)
    (with-default-read sponsored-trades trade-id { "sponsored": false } { "sponsored" := s } s))
  ;; Is the gas payer of this transaction the free-take station?
  (defun station-pays:bool ()
    (let ((station (at "station" (get-sponsorship))))
      (and (!= station "") (= (at "sender" (chain-data)) station))))
  ;; A buyer who has no account on this chain yet (new wallet, or KDA only on other chains): the account is created
  ;; from the guard in the transaction data ("taker-guard"), which must match the k: address.
  (defun account-exists:bool (account:string)
    (try false (let ((d (coin.details account))) true)))
  (defun account-guard:guard (account:string)
    (if (account-exists account)
      (at "guard" (coin.details account))
      (let ((g (read-keyset "taker-guard")))
        (enforce (validate-principal g account) "taker-guard does not match the account")
        g)))

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
    (require-capability (INTERNAL))
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
    (require-capability (INTERNAL))
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
  ;; Either way an open offer gets the amount back as available: a SELL pool holds it again, and a BUY
  ;; offer can be taken again for it (the seller of a BUY trade always gets their KDA back).
  (defun return-from-trade (trade-id:string offer-id:string seller:string amount:decimal)
    (require-capability (INTERNAL))
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
              (update offers offer-id
                (if (= ostate "OPEN")
                  { "available": (+ available amount), "locked": (- locked amount) }
                  { "available": available, "locked": (- locked amount) }))))))))

  (defun settle-locked (offer-id:string amount:decimal)
    (require-capability (INTERNAL))
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
      (enforce (or (= (length token) 0) (token-approved token)) "This token is not approved for instant swaps")
      (valid-window pay-window)
      (enforce (or (= expires-at EPOCH) (> expires-at (now))) "Expiry must be in the future")
      (enforce (!= creator (get-arbiter)) "The arbiter cannot trade")
      (enforce (!= creator (get-agent)) "The release agent cannot trade")
      (valid-agent agent)
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
        (valid-agent agent)
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
      (enforce (!= taker (get-arbiter)) "The arbiter cannot trade")
      (enforce (!= taker (get-agent)) "The release agent cannot trade")
      (enforce (!= taker (at "agent" (read offers offer-id))) "The offer's agent cannot take it")
      (valid-account taker)
      (valid-amount amount "Amount")
      (enforce (>= amount min) "Below the minimum for this offer")
      (enforce (<= amount max) "Above the maximum for this offer")
      (enforce (<= amount available) "Not enough left in this offer")))

  (defun new-trade-id (trade-id:string)
    (enforce (and (> (length trade-id) 0) (<= (length trade-id) 128)) "Invalid trade id")
    (with-default-read trades trade-id { "offer": "" } { "offer" := existing }
      (enforce (= (length existing) 0) "Trade exists")))

  ;; Checks and counts a free take. The station itself refuses to pay unless (sponsor-take-ok) passes, so a free
  ;; take that fails here costs the station nothing it had not already agreed to.
  (defun sponsor-take (trade-id:string offer-id:string taker:string amount:decimal)
    (require-capability (INTERNAL))
    (sponsor-take-ok offer-id taker amount)
    (let* ((day (utc-day)) (dk (+ "day:" day)) (bk (format "buyer:{}:{}" [taker day])) (pk (format "pool:{}:{}" [offer-id day])))
      (write sponsor-counts dk { "count": (+ 1 (sponsor-count dk)) })
      (write sponsor-counts bk { "count": (+ 1 (sponsor-count bk)) })
      (write sponsor-counts pk { "count": (+ 1 (sponsor-count pk)) })
      (write sponsored-trades trade-id { "sponsored": true })))

  ;; Read-only: may the station pay for this take? Used by the station before paying and by sponsor-take.
  (defun sponsor-take-ok:bool (offer-id:string taker:string amount:decimal)
    (let ((sp (get-sponsorship)) (left (free-takes-left taker)))
      (enforce (!= (at "station" sp) "") "Free takes are off")
      (with-read offers offer-id { "side" := side, "token" := token, "price" := price }
        (enforce (= side "SELL") "Free takes are for SELL offers")
        (enforce (= (length token) 0) "Free takes are not for instant swaps")
        (enforce (> price 0.0) "Free takes are not for giveaways"))
      (enforce (<= amount (at "max-amount" sp)) "Above the largest free take")
      (enforce (> (at "today" left) 0) "No free takes left today")
      (enforce (> (at "buyer" left) 0) "No free takes left today for this buyer")
      (enforce (< (sponsor-count (format "pool:{}:{}" [offer-id (utc-day)])) FREE_PER_POOL) "No free takes left today on this pool")
      true))

  ;; Read-only: may the station pay for this buyer step (mark-paid, cancel, open-dispute) on a free-take trade?
  (defun sponsor-step-ok:bool (which:string trade-id:string)
    (enforce (!= (at "station" (get-sponsorship)) "") "Free takes are off")
    (enforce (is-sponsored-trade trade-id) "Only trades taken for free")
    (with-read trades trade-id { "state" := state, "funded-at" := funded-at, "paid-at" := paid-at, "pay-window" := window }
      (enforce (contains which ["mark-paid" "cancel" "open-dispute"]) "Unknown step")
      (let ((in-grace (<= (now) (add-time funded-at (+ window GRACE_S)))))
        (if (= which "mark-paid")
          (enforce (and (= state "FUNDED") in-grace) "Cannot mark paid now")
          (if (= which "cancel")
            (enforce (and (= state "FUNDED") in-grace) "Cannot cancel now")
            (enforce (or (and (= state "FUNDED") in-grace)
                         (and (= state "PAID") (<= (now) (add-time paid-at (+ (at "t-release" (read config "global")) LATE_DISPUTE_S)))))
                     "Cannot dispute now"))))
      true))

  ;; Take a slice of an offer. SELL: the KDA moves from the pool to the trade's vault, so the
  ;; trade starts FUNDED (a free giveaway goes straight to the taker). BUY: the taker locks the
  ;; KDA themselves in the same transaction.
  ;; A buyer with no account on this chain yet gets one, created from "taker-guard" in the transaction data.
  ;; When the free-take gas station pays for the transaction, the take must fit its limits (see sponsor-take).
  (defun take-offer (trade-id:string offer-id:string taker:string amount:decimal)
    (with-capability (INTERNAL)
    (not-paused)
    (new-trade-id trade-id)
    (check-take offer-id taker amount)
    (if (account-exists taker) "account exists" (coin.create-account taker (account-guard taker)))
    (if (station-pays) (sponsor-take trade-id offer-id taker amount) "buyer pays gas")
    (with-capability (ACCOUNT_AUTH taker)
      (with-read offers offer-id
        { "creator" := creator, "side" := side, "available" := available, "locked" := locked
        , "price" := price, "currency" := currency, "token" := token, "pay-window" := pay-window
        , "agent" := agent, "takes" := takes }
        (enforce (= (length token) 0) "This offer settles instantly: use take-and-settle")
        (let* ((agent    (if (= agent (get-agent)) agent "")) ; a revoked agent never reaches a new trade
               (sell     (= side "SELL"))
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
          trade-id)))))

  ;; Instant swap: the buyer pays `pay` of the token and receives the KDA in one transaction.
  ;; `pay` must cover amount * price (rounded to the token's precision) and not exceed it rounded up; the buyer
  ;; signs the token's TRANSFER capability (buyer -> seller, pay), so the site computes `pay` and the chain checks it.
  ;; The token module is outside code chosen by the seller, so INTERNAL is not held while it runs: a token that
  ;; calls back into this module cannot reach the money-moving helpers.
  (defun take-and-settle (trade-id:string offer-id:string taker:string amount:decimal token:module{fungible-v2} pay:decimal)
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
        (enforce (token-approved token-name) "This token is no longer approved for instant swaps")
        (let* ((agent (if (= agent (get-agent)) agent ""))
               (fee  (fee-for amount))
               (prec (token::precision))
               (due  (round (* amount price) prec))
               (net  (- amount fee))
               (pool (offer-vault offer-id)))
          (enforce (> due 0.0) "Payment rounds to zero")
          (enforce (= pay (floor pay prec)) "Payment has too many decimals for this token")
          (enforce (>= pay due) (format "Payment must be at least {} {}" [due currency]))
          (enforce (<= pay (ceiling (* amount price) prec)) (format "Payment is more than the {} {} due" [due currency]))
          ;; the trade and the pool's new balance are written before any token code runs, so a token that calls
          ;; back into this module sees the pool as it will be
          (insert trades trade-id
            { "offer": offer-id, "seller": creator, "buyer": taker, "amount": amount
            , "price": price, "currency": currency, "token": token-name
            , "pay-amount": pay, "fee": fee, "pay-window": pay-window, "agent": agent
            , "state": "COMPLETED", "funded-at": (now), "paid-at": (now), "closed-at": (now) })
          (update offers offer-id { "available": (- available amount), "takes": (+ takes 1) })
          ;; token: buyer -> seller
          (token::transfer taker creator pay)
          ;; KDA: pool -> buyer (and fee)
          (with-capability (OFFER_VAULT offer-id)
            (with-read config "global" { "fee-account" := fee-account }
              (if (or (= fee 0.0) (= taker fee-account))
                (let ((x 0))
                  (install-capability (coin.TRANSFER pool taker amount))
                  (coin.transfer pool taker amount))
                (let ((x 0))
                  (install-capability (coin.TRANSFER pool taker net))
                  (coin.transfer pool taker net)
                  (install-capability (coin.TRANSFER pool fee-account fee))
                  (coin.transfer pool fee-account fee)))))
          (with-capability (INTERNAL)
            (bump creator true false false amount)
            (bump taker true false false amount))
          (emit-event (TRADE_EVENT trade-id offer-id "COMPLETED" creator taker amount))
          trade-id))))

  ;; ------------------------------------------------------------------- trades

  (defun mark-paid (trade-id:string)
    (with-read trades trade-id { "offer" := offer, "buyer" := buyer, "seller" := seller, "state" := state, "funded-at" := funded-at, "pay-window" := window, "amount" := amount }
      (with-capability (ACCOUNT_AUTH buyer)
        (enforce (= state "FUNDED") "Trade is not waiting for payment")
        (enforce (<= (now) (add-time funded-at (+ window GRACE_S))) "Payment window and grace period have passed")
        (enforce (or (not (station-pays)) (sponsor-step-ok "mark-paid" trade-id)) "Not a free-take trade")
        (update trades trade-id { "state": "PAID", "paid-at": (now) })
        (emit-event (TRADE_EVENT trade-id offer "PAID" seller buyer amount))
        trade-id)))

  ;; The seller (any time while FUNDED or PAID) or the offer's agent sends the KDA to the buyer.
  ;; An agent can do nothing else: no refund, no other recipient, no other amount, and only while it is still
  ;; the platform's agent (revoking it in config stops it on open trades too).
  (defun release (trade-id:string)
    (with-capability (INTERNAL)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "fee" := fee, "state" := state, "agent" := agent }
      (enforce (contains state ["FUNDED" "PAID"]) "Trade cannot be released from this state")
      (enforce-one "Only the seller or the offer's agent can release"
        [ (with-capability (ACCOUNT_AUTH seller) true)
          (and (enforce (> (length agent) 0) "No agent")
               (and (enforce (= agent (get-agent)) "This trade's agent has been revoked")
                    (with-capability (ACCOUNT_AUTH agent) true))) ])
      (pay-from-trade trade-id buyer amount fee)
      (settle-locked offer amount)
      (update trades trade-id { "state": "COMPLETED", "closed-at": (now) })
      (bump seller true false false amount)
      (bump buyer true false false amount)
      (emit-event (TRADE_EVENT trade-id offer "COMPLETED" seller buyer amount))
      trade-id)))

  ;; The buyer backs out before paying. The KDA goes back to the pool.
  (defun cancel (trade-id:string)
    (with-capability (INTERNAL)
    (with-read trades trade-id { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state }
      (with-capability (ACCOUNT_AUTH buyer)
        (enforce (= state "FUNDED") "Only an unpaid trade can be cancelled")
        (enforce (or (not (station-pays)) (sponsor-step-ok "cancel" trade-id)) "Not a free-take trade")
        (return-from-trade trade-id offer seller amount)
        (update trades trade-id { "state": "CANCELLED", "closed-at": (now) })
        (bump buyer false false true 0.0)
        (emit-event (TRADE_EVENT trade-id offer "CANCELLED" seller buyer amount))
        trade-id))))

  ;; The buyer never marked paid within the window and the grace period after it: the seller takes the KDA back.
  (defun timeout-refund (trade-id:string)
    (with-capability (INTERNAL)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state, "funded-at" := funded-at, "pay-window" := window }
      (with-capability (ACCOUNT_AUTH seller)
        (enforce (= state "FUNDED") "Trade is not waiting for payment")
        (enforce (> (now) (add-time funded-at (+ window GRACE_S))) "Payment window and grace period have not passed yet")
        (return-from-trade trade-id offer seller amount)
        (update trades trade-id { "state": "REFUNDED", "closed-at": (now) })
        (bump buyer false false true 0.0)
        (emit-event (TRADE_EVENT trade-id offer "REFUNDED" seller buyer amount))
        trade-id))))

  ;; Buyer: any time before completion (for example "I paid but the seller is silent").
  ;; Seller: as soon as the buyer has marked paid (for example "nothing arrived"). The config's t-release is not a
  ;; gate here; the site uses it to show when a seller is late to release.
  (defun open-dispute (trade-id:string)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "state" := state }
      (enforce (contains state ["FUNDED" "PAID"]) "Trade cannot be disputed from this state")
      (enforce (or (not (station-pays)) (sponsor-step-ok "open-dispute" trade-id)) "Not a free-take trade")
      (enforce-one "Only the buyer, or the seller after mark-paid, can dispute"
        [ (with-capability (ACCOUNT_AUTH buyer) true)
          (and (enforce (= state "PAID") "Seller can dispute after mark-paid") (with-capability (ACCOUNT_AUTH seller) true)) ])
      (update trades trade-id { "state": "DISPUTED" })
      (emit-event (TRADE_EVENT trade-id offer "DISPUTED" seller buyer amount))
      trade-id))

  ;; The arbiter settles a dispute: `to-buyer` KDA to the buyer, the rest back to the seller.
  ;; The arbiter has no power over a trade that is not disputed.
  (defun resolve (trade-id:string to-buyer:decimal)
    (with-capability (INTERNAL)
    (with-read trades trade-id
      { "offer" := offer, "seller" := seller, "buyer" := buyer, "amount" := amount, "fee" := fee, "state" := state }
      (with-capability (ACCOUNT_AUTH (get-arbiter))
        (enforce (= state "DISPUTED") "Trade is not disputed")
        (enforce (and (>= to-buyer 0.0) (<= to-buyer amount)) "Split must be between 0 and the trade amount")
        (enforce (= to-buyer (floor to-buyer 12)) "Split has more than 12 decimals")
        (let* ((to-seller  (- amount to-buyer))
               (fee-part   (if (= to-buyer amount) fee (if (= to-buyer 0.0) 0.0 (floor (/ (* fee to-buyer) amount) 12))))
               (new-state  (if (= to-buyer amount) "COMPLETED" (if (= to-buyer 0.0) "REFUNDED" "SPLIT")))
               ;; If the fee account is the seller, its fee goes with the seller's share in one transfer
               ;; (two managed TRANSFERs to the same receiver cannot be installed in one transaction).
               (merge      (= seller (at "fee-account" (read config "global"))))
               (buyer-gets (if merge (- to-buyer fee-part) to-buyer))
               (buyer-fee  (if merge 0.0 fee-part))
               (seller-gets (if merge (+ to-seller fee-part) to-seller)))
          (if (> buyer-gets 0.0) (pay-from-trade trade-id buyer buyer-gets buyer-fee) "nothing to buyer")
          (if (> seller-gets 0.0)
            (with-capability (TRADE_VAULT trade-id)
              (let ((vault (trade-vault trade-id)))
                (install-capability (coin.TRANSFER vault seller seller-gets))
                (coin.transfer vault seller seller-gets)))
            "nothing to seller")
          (settle-locked offer amount)
          (update trades trade-id { "state": new-state, "closed-at": (now) })
          (bump seller false true false 0.0)
          (bump buyer false true false 0.0)
          (emit-event (TRADE_EVENT trade-id offer new-state seller buyer to-buyer))
          new-state)))))

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

;; --- revision 3 setup, in the same transaction ---
(create-table free.p2p-escrow-v11.tokens)
(create-table free.p2p-escrow-v11.sponsorship)
(create-table free.p2p-escrow-v11.sponsor-counts)
(create-table free.p2p-escrow-v11.sponsored-trades)

(namespace "free")
(module p2p-escrow-v11-gas GOVERNANCE
  (implements gas-payer-v1)
  (use coin)

  (defcap GOVERNANCE ()
    (enforce-guard (keyset-ref-guard "free.p2p-escrow-v11-gov")))

  ;; A transaction that passes GAS_PAYER and then fails still costs the station its whole gas limit, so the limit and
  ;; price are kept low (2000 × 0.00000001 = 0.00002 KDA at most) and every payment counts against a daily budget.
  (defconst MAX_GAS_LIMIT:integer 2000)   ; a free take that creates the buyer's account measured about 1,000 gas
  (defconst MAX_GAS_PRICE:decimal 0.00000001)
  ;; Transactions the station pays per UTC day: four per free take (the take, I paid, cancel or dispute, a retry).
  (defconst PAYMENTS_PER_FREE_TAKE:integer 4)

  (defschema count-row count:integer)
  ;; payments made per UTC day ("YYYY-MM-DD"); written while gas is bought, so failed transactions count too
  (deftable payments:{count-row})
  (defun payments-on:integer (day:string) (with-default-read payments day { "count": 0 } { "count" := c } c))
  (defun payments-left:integer ()
    @doc "Payments the station can still make today."
    (- (* PAYMENTS_PER_FREE_TAKE (at "daily" (free.p2p-escrow-v11.get-sponsorship))) (payments-on (free.p2p-escrow-v11.utc-day))))
  (defconst TAKE_CODE:string "(free.p2p-escrow-v11.take-offer (read-msg \"trade\") (read-msg \"offer\") (read-msg \"taker\") (read-decimal \"amount\"))")
  (defun step-code:string (which:string) (format "(free.p2p-escrow-v11.{} (read-msg \"trade\"))" [which]))

  ;; The buyer's guard: their account's, or for a buyer whose account the take will create, the "taker-guard"
  ;; in the data, which must belong to the k: address.
  (defun buyer-guard:guard (account:string data:object)
    (if (free.p2p-escrow-v11.account-exists account)
      (at "guard" (coin.details account))
      (let ((g (at "taker-guard" data)))
        (enforce (validate-principal g account) "taker-guard does not match the account")
        g)))

  ;; JSON may carry a whole number as an integer; the escrow reads it with read-decimal.
  (defun as-decimal:decimal (v)
    (if (= (typeof v) "integer") (dec v) v))

  (defcap GAS_PAYER:bool (user:string limit:integer price:decimal)
    (enforce (= "exec" (at "tx-type" (read-msg))) "Only exec transactions")
    (enforce (<= (at "gas-limit" (chain-data)) MAX_GAS_LIMIT) "Gas limit too high for a free take")
    (enforce (<= (at "gas-price" (chain-data)) MAX_GAS_PRICE) "Gas price too high for a free take")
    (let ((codes (at "exec-code" (read-msg))) (d (at "exec-user-data" (read-msg))))
      (enforce (= 1 (length codes)) "Only one call per transaction")
      (let ((c (at 0 codes)))
        (if (= c TAKE_CODE)
          (let ((taker (at "taker" d)) (offer (at "offer" d)) (amount (as-decimal (at "amount" d))) (trade (at "trade" d)))
            ;; the same checks the take makes first, so a free take does not fail after the gas is bought
            (free.p2p-escrow-v11.not-paused)
            (free.p2p-escrow-v11.new-trade-id trade)
            (free.p2p-escrow-v11.check-take offer taker amount)
            (free.p2p-escrow-v11.sponsor-take-ok offer taker amount)
            (enforce-guard (buyer-guard taker d)))
          (let ((which (if (= c (step-code "mark-paid")) "mark-paid"
                        (if (= c (step-code "cancel")) "cancel"
                          (if (= c (step-code "open-dispute")) "open-dispute" "")))))
            (enforce (!= which "") "Only a free take or the buyer's own steps on it")
            (let ((trade (at "trade" d)))
              (free.p2p-escrow-v11.sponsor-step-ok which trade)
              (enforce-guard (at "guard" (coin.details (at "buyer" (free.p2p-escrow-v11.get-trade trade))))))))))
    ;; the daily budget: counted now, so a transaction that fails after this still uses one
    (let ((day (free.p2p-escrow-v11.utc-day)))
      (enforce (> (payments-left) 0) "The free-take station's budget for today is used up")
      (write payments day { "count": (+ 1 (payments-on day)) }))
    (compose-capability (ALLOW_GAS)))

  (defcap ALLOW_GAS () true)

  (defun create-gas-payer-guard:guard ()
    (create-user-guard (gas-payer-guard)))

  (defun gas-payer-guard:bool ()
    (require-capability (GAS))
    (require-capability (ALLOW_GAS)))

  (defun account:string ()
    @doc "The principal account that pays for free takes. Fund it with a few KDA."
    (create-principal (create-gas-payer-guard)))
)
(create-table free.p2p-escrow-v11-gas.payments)

;; Tokens approved for instant swaps on this chain (the same list as shared/v11-chains.js).
(if (= (at "chain-id" (chain-data)) "1")
  [ (free.p2p-escrow-v11.set-token "n_582fed11af00dc626812cd7890bb88e72067f28c.bro" true)
    (free.p2p-escrow-v11.set-token "runonflux.flux" true) ]
  [ (free.p2p-escrow-v11.set-token "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC" true)
    (free.p2p-escrow-v11.set-token "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH" true)
    (free.p2p-escrow-v11.set-token "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDT" true) ])
