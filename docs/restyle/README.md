# Kadena P2P Marketplace – Nexus restyle

Front end only. No changes to the Pact contract, wallet code or API calls, so no new audit.
Expected time: about 2–3 hours.

1. **Theme** – in `src/index.css`, replace the `:root` and `.dark` blocks with
   `1-theme-index.css`. Add the `.nx-pulse` block from the same file.
2. **Fonts, meta, Tailwind** – follow `2-fonts-and-tailwind.md`.
3. **Landing page** – add `3-NexusLanding.tsx` as `src/components/NexusLanding.tsx` and
   render it in place of the old landing content, passing the existing connect/install
   control: `<NexusLanding walletAction={<ExistingWalletButton />} />`.
4. **Copy** – apply `4-copy-changes.md` (name, header, footer, role picker, BUSD).
5. **Status colors** – apply `5-status-colors.md`.
6. Build, deploy, and check in light and dark mode:
   landing page, connect wallet, offer list, one open trade, profile, dispute page.

Reference design: `Kadena-P2P-Marketplace.html` (open in a browser).

Update 10 Oct: the landing component now includes a "practice trade with yourself" section
(two wallets, 1 KDA) between the comparison and "Before your first trade"; the hero's second
button links to it. Also add the same hint to the role picker shown after connecting:
  "New here? Try a 1 KDA trade between two of your own wallets first."
- Oct 10 (later): the Created step of the example trade and a new rule in "Before your first trade" now say an open offer never expires and that the 1 h / 4 h / 2 h limits start only after acceptance. These numbers mirror what the app already shows in the Before You Trade modal; please confirm they match free.p2p-escrow-v10 before deploying.

## Oct 10, second update: new landing sections and props

`3-NexusLanding.tsx` was regenerated. It now has, in page order: hero, contract facts (with an optional "View the contract source" link), how a trade
works, comparison, **What you need before you start**, practice trade (with an optional video),
**FAQ** (6 questions, `<details>` accordions), before your first trade + connect. All copy exists
in English and Arabic; the page switches to `dir="rtl"` for Arabic. Nothing in it calls the
contract, a wallet or an API; everything live comes in through props.

New optional props (all can be left out; the matching element then hides):

- `practiceVideoUrl` - a YouTube/Vimeo embed URL or a direct .mp4/.webm link. Naif will send
  the 30-second recording; until then leave the prop out (the mockup shows a placeholder frame).
- `contractUrl` - link to the contract source (the .pact file in the Kadena Nexus GitHub repo,
  or an explorer page for `free.p2p-escrow-v10`). Leave out until there is a URL.

Language: the component keeps the choice in `localStorage` under `nx-lang` and defaults to
Arabic when the browser language starts with `ar`. The toggle pill sits at the top of the hero;
if you would rather have it in the header, import `useLang` from the component and render your
own button there (then delete the pill in the hero). The header and footer themselves stay
English for now.

## Oct 10, checked against the real code (Cool-Dev tip 11a381b, Apr 26)

- Stack matches: React 18, Vite 5, Tailwind 3.4.17 (logical `ps-`/`pe-` utilities work), shadcn HSL tokens in `src/index.css`.
- Where to render: `src/pages/Index.tsx`, the logged-out branch currently renders `<Dashboard />`:
  `{!isConnected ? <Dashboard /> : (...)}`  ->  `{!isConnected ? <NexusLanding walletAction={<WalletConnect />} /> : (...)}`
  (`WalletConnect` is already imported there.) Keep the header in Index.tsx; restyle it per 4-copy-changes.md.
- Time limits: `p2p-escrow.pact` (module p2p-escrow-v10) has T1 3600, T2 14400, T3 3600, and `src/lib/kadena.ts` matches.
  So the landing page says 1 h to fund, 4 h to mark paid, 1 h to release. `TradeWarningModal.tsx` line ~89 says
  "2 hours to release after payment is marked"; change it to "1 hour" so the app agrees with the contract.
  (If v10 on chain was deployed with different constants than the file, tell Naif and we change the page.)
- Platform fee: none in the contract (the comparison table in the old landing said "Zero"); gas "under 0.0001 KDA"
  assumes gasLimit 2500 at 1e-8, as in `src/lib/kadena.ts`.
- `p2p-escrow-update.pact` (module p2p-escrow12, 20-minute limits, different arbiter key) is in the repo but not what
  the app uses; ignore it for this work.
