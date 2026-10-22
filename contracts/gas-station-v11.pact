;; Kadena P2P Marketplace: free-take gas station for free.p2p-escrow-v11.
;;
;; A coin account guarded by this module pays the gas of a buyer's transaction that
;;   (1) does exactly one thing, written exactly as one of these (arguments come from the transaction data):
;;         (free.p2p-escrow-v11.take-offer (read-msg "trade") (read-msg "offer") (read-msg "taker") (read-decimal "amount"))
;;         (free.p2p-escrow-v11.mark-paid (read-msg "trade"))
;;         (free.p2p-escrow-v11.cancel (read-msg "trade"))
;;         (free.p2p-escrow-v11.open-dispute (read-msg "trade"))
;;   (2) stays under a gas limit and gas price,
;;   (3) passes the escrow's own checks before any gas is spent (offer open, slice within limits, free takes left
;;       today; for a later step, a trade that was taken for free and is in the right state), and
;;   (4) is signed by the buyer (the key also signs GAS_PAYER).
;; Anything else is refused, so the account can only pay for buyers' takes and their own later steps on those
;; trades. The escrow caps free takes per day overall and per buyer, and the largest free slice.
;;
;; Part of Kadena Nexus. MIT licensed.
(namespace "free")
(module p2p-escrow-v11-gas GOVERNANCE
  (implements gas-payer-v1)
  (use coin)

  (defcap GOVERNANCE ()
    (enforce-guard (keyset-ref-guard "free.p2p-escrow-v11-gov")))

  (defconst MAX_GAS_LIMIT:integer 3000)   ; a free take that creates the buyer's account measured about 1,000 gas
  (defconst MAX_GAS_PRICE:decimal 0.0000001)
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
