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
    state:string)

  (deftable escrows:{escrow})

  ;; NOTE: create-table must run at TOP LEVEL (outside the module). Run once after deploy:
  ;;   (create-table free.p2p-escrow.escrows)
  ;; Use the "Initialize" button in Manage Escrow, or add that to your deployment tx.

  ;; ------------------------------------------------------------
  ;; Create offer (seller creates; platform arbiter is used)
  ;; ------------------------------------------------------------
  (defun create-offer (id creator amount)
    (enforce (= (read-msg "sender") creator) "Creator must be the transaction sender")
    (enforce
      (not (try false (read escrows id)))
      "Escrow exists")
    (enforce (> amount 0.0) "Amount must be > 0")
    (enforce (> (length creator) 0) "Creator required")
    (enforce (!= creator PLATFORM_ARBITER) "Creator and arbiter must be different")
    (insert escrows id
      { "creator": creator
      , "buyer": ""
      , "arbiter": PLATFORM_ARBITER
      , "amount": amount
      , "state": "CREATED" }))

  ;; ------------------------------------------------------------
  ;; Accept offer (buyer chooses an offer; caller becomes the buyer)
  ;; ------------------------------------------------------------
  (defun accept-offer (id)
    (let ((buyer (read-msg "sender")))
      (with-read escrows id { "state" := s }
        (enforce (= s "CREATED") "Invalid state")
        (update escrows id { "buyer": buyer, "state": "ACCEPTED" }))))

  ;; ------------------------------------------------------------
  ;; Deposit (seller locks KDA in vault)
  ;; ------------------------------------------------------------
  (defun deposit (id)
    (with-read escrows id
      { "creator" := c
      , "amount" := a
      , "state" := s }
      (enforce (= s "ACCEPTED") "Invalid state")
      (enforce (= c (read-msg "sender")) "Only creator")
      (coin.transfer c VAULT_ACCOUNT a)
      (update escrows id { "state": "FUNDED" })))

  ;; ------------------------------------------------------------
  ;; Mark paid (buyer confirms off-chain payment to seller)
  ;; ------------------------------------------------------------
  (defun mark-paid (id)
    (with-read escrows id
      { "buyer" := b
      , "state" := s }
      (enforce (= s "FUNDED") "Invalid state")
      (enforce (= b (read-msg "sender")) "Only buyer")
      (update escrows id { "state": "PAID" })))

  ;; ------------------------------------------------------------
  ;; Release (seller or arbiter sends KDA from vault to buyer)
  ;; Second call fails: state is COMPLETED, no longer PAID
  ;; ------------------------------------------------------------
  (defun release (id)
    (with-read escrows id
      { "creator" := c
      , "buyer" := b
      , "arbiter" := a
      , "amount" := amt
      , "state" := s }
      (enforce (= s "PAID") "Invalid state")
      (enforce
        (or (= (read-msg "sender") c)
            (= (read-msg "sender") a))
        "Only seller or arbiter can release")
      (coin.transfer VAULT_ACCOUNT b amt)
      (update escrows id { "state": "COMPLETED" })))

  ;; ------------------------------------------------------------
  ;; Refund (arbiter returns funds to seller; offer reset to CREATED for re-use)
  ;; Any buyer can accept again; seller must deposit again after accept
  ;; ------------------------------------------------------------
  (defun refund (id)
    (with-read escrows id
      { "creator" := c
      , "arbiter" := a
      , "amount" := amt
      , "state" := s }
      (enforce (or (= s "PAID") (= s "FUNDED")) "Invalid state for refund")
      (enforce (= (read-msg "sender") a) "Only arbiter")
      (coin.transfer VAULT_ACCOUNT c amt)
      (update escrows id { "buyer": "", "state": "CREATED" })))

  ;; ------------------------------------------------------------
  ;; Close offer (seller marks offer closed in CREATED state only)
  ;; Pact tables do not support row deletion; we set state to CLOSED
  ;; ------------------------------------------------------------
  (defun close-offer (id)
    (with-read escrows id { "creator" := c, "state" := s }
      (enforce (= s "CREATED") "Can only close in CREATED state")
      (enforce (= (read-msg "sender") c) "Only seller can close")
      (update escrows id { "state": "CLOSED" })))

  (defun get-escrow (id)
    (read escrows id))

  ;; Returns all offer IDs in the escrows table (for listing in Manage Escrow)
  (defun list-escrow-ids ()
    (keys escrows))
)
