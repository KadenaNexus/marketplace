# Copy changes (search the repo for the text on the left)

Find each string with `grep -rn "<text>" src/` and replace it. Only text changes; no logic.

## Name (header, modal, page title)
| Find | Replace with |
|---|---|
| `KadenaEscrow – Decentralized P2P Trading Marketplace` | `Kadena P2P Marketplace` |
| `Part of the Kadena Nexus Ecosystem` | `Part of Kadena Nexus` |
| `Kadena Nexus Marketplace is decentralized` | `Kadena P2P Marketplace is decentralized` |
| `Built on Kadena • Powered by Pact Smart Contracts` (footer) | `Built by Mica Dimic, winner of the Kadena Devs escrow challenge. Part of Kadena Nexus.` (link "Kadena Nexus" to https://kadena.ws) |

Header layout: Nexus logo mark, then the name, then a small "Part of Kadena Nexus" link.
Remove the "mainnet01 • Chain 1" mono line under the title and show it instead as a small
pill on the right: `Mainnet · Chain 1`. Keep the theme toggle. The wallet control goes last,
as a filled primary button ("Connect wallet"), not a yellow text link.

## Landing page
Replace the old landing content (hero, Binance comparison table, the three feature cards,
"Why Choose Us?", "How It Works", "Ready to Start Trading?", "Escrow Transaction Flow")
with `<NexusLanding walletAction={...} />` from 3-NexusLanding.tsx. That removes all of:
"Why We're Better Than CEX & Binance P2P", "Jurisdiction Risk", "Account Suspension:
Impossible", "Censorship Risk: None", "Instant Settlement", "near-instant finality".

## Role picker (after connecting)
| Find | Replace with |
|---|---|
| `Fast and instant transactions` | `A deadline on every step, enforced on-chain` |
| `Sell your KDA to buyers with guaranteed payment protection` | `Sell your KDA. It stays in escrow until you confirm the buyer's payment` |
| `Escrow ensures payment before release` | `You release only after the payment arrives` |

## Payment methods
Remove `BUSD` from the payment-method lists (create offer and the filter). Binance stopped
supporting BUSD, so it should not be offered for new trades. Leave it readable on old offers.

## "Before You Trade" modal (shown on first visit)
| Find | Replace with |
|---|---|
| `Time limits are strictly enforced on-chain and cannot be extended` | `Each step has a time limit, enforced by the contract` |
| `Missing a deadline triggers an automatic timeout, cancels the trade, and damages your reputation score.` | `If a deadline passes, the trade is cancelled and any KDA in escrow returns to the seller. Nobody loses funds.` |
| `The platform cannot intervene to extend timeouts or reverse transactions.` | `Either side can open a dispute at any time and the arbiter will step in. For help, ask in the Kadena Nexus Telegram group: t.me/KadenaNexus` |

## TradeWarningModal.tsx (pre-trade pop-up)
- "2 hours to release after payment is marked" -> "1 hour to release after payment is marked" (T3_SECONDS is 3600 in the contract).
