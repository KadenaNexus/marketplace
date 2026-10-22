// src/components/NexusLanding.tsx
// New logged-out landing page for the Kadena P2P Marketplace, in the Kadena Nexus style.
// Pure presentation: no contract, wallet or API calls. Uses only React + Tailwind and the
// theme tokens from src/index.css (bg-background, text-primary, border-border, ...).
// English and Arabic copy live in COPY below; the page switches direction (dir="rtl") for Arabic.
//
// Usage: render it where the old landing content was (the page shown before a wallet is
// connected) and pass the app's existing connect/install control as `walletAction`:
//
//   <NexusLanding
//     walletAction={<ExistingWalletButton />}
//     contractUrl="https://github.com/.../p2p-escrow-v11.pact" // optional, see README
//   />
//
// The header and footer stay in their own components (see 4-copy-changes.md). The language
// pill rendered at the top of the hero can be moved into the header if you prefer; it only
// needs `lang` and `setLang` (export `useLang` below).

import { ReactNode, useEffect, useState } from "react";
import { OfferAlertsButton } from "@/components/OfferAlerts";
import { linxStoreLink } from "@/components/OpenInLinx";
import { ALERTS_COPY } from "@/lib/alertsCopy";

export type Lang = "en" | "ar";

type Pair = [string, string];
type Triple = [string, string, string];

type Copy = {
  langName: string; switchTo: string; switchAria: string;
  hero: { h1: string; p: string; try: string; note: string };
  stats: { openOffers: string; completedTrades: string; kdaSettled: string; sample: string };
  example: {
    title: string; amount: string; price: string; perKda: string; buyerPays: string; payWith: string;
    payWithValue: string; left: string; done: string; steps: Triple[];
  };
  facts: {
    contract: string; chain: string; view: string; review: string; reviewSub: string;
    bounty: string; bountyValue: string; bountySub: string; fee: string; feeValue: string; feeSub: string;
  };
  how: {
    h2: string; p: string; steps: Pair[]; deadlineH: string; deadlineP: string; wrongH: string; wrongP: string;
    personH: string; personPre: string; personLink: string; personPost: string;
    watchCaption: string;
  };
  compare: { h2: string; p: string; ours: string; theirs: string; rows: Triple[]; note: string };
  need: { h2: string; p: string; items: Pair[] };
  faq: { h2: string; items: Pair[] };
  rules: { h2: string; items: Pair[] };
  start: { lead: string; getWallet: string; connect: string; questionsPre: string; tg: string; questionsPost: string };
};

const COPY: Record<Lang, Copy> = {
  "en": {
    "langName": "English",
    "switchTo": "العربية",
    "switchAria": "Switch to Arabic",
    "hero": {
      "h1": "Trade KDA person to person, with the coins held in escrow",
      "p": "Made for your phone with Linx Wallet. A seller's KDA is locked in a Pact contract the moment they post a pool, so when you take part of it the trade starts at once. Pay in USDT or USDC and the seller releases the KDA once your payment arrives. Pay in BRO, FLUX, kb-USDC, kb-ETH or kb-USDT and the swap is instant. An arbiter settles disputes.",
      "try": "Watch a trade (2 min)",
      "note": "No account, no ID check and no platform fee. You confirm an email for trade notices and pay only Kadena network gas."
    },
    "stats": {
      "openOffers": "open pools right now",
      "completedTrades": "completed trades",
      "kdaSettled": "KDA settled through escrow",
      "sample": "sample figures"
    },
    "example": {
      "title": "Example trade",
      "amount": "Buyer takes",
      "price": "Price",
      "perKda": "per KDA",
      "buyerPays": "Buyer pays",
      "payWith": "Pay with",
      "payWithValue": "USDT on Tron",
      "left": "left",
      "done": "done",
      "steps": [
        [
          "OPEN",
          "Pool posted",
          "Seller posted a 500 KDA pool. All 500 KDA are locked in the escrow contract right away"
        ],
        [
          "TAKEN",
          "Taken",
          "A buyer took 200 KDA. They are locked for this buyer at once; 300 KDA stay in the pool for others"
        ],
        [
          "PAID",
          "Paid",
          "Buyer sent 1.92 USDT on Tron to the address in the trade and tapped \"I paid\" with the transaction hash"
        ],
        [
          "COMPLETED",
          "Released",
          "Seller saw the USDT arrive and released 200 KDA to the buyer"
        ]
      ]
    },
    "facts": {
      "contract": "Escrow contract",
      "chain": "Chains 1 and 2, Kadena mainnet",
      "view": "View the contract source",
      "review": "Trade time limits",
      "reviewSub": "to pay, set per pool · then 1 h to release",
      "bounty": "New traders",
      "bountyValue": "500 KDA",
      "bountySub": "per trade, until 3 completed trades",
      "fee": "Platform fee",
      "feeValue": "None",
      "feeSub": "only network gas, under 0.0001 KDA per transaction; the contract caps any future fee at 1%"
    },
    "how": {
      "h2": "How a trade works",
      "p": "Four steps when you pay in USDT or USDC, each recorded on Chainweb. The KDA goes into escrow when the pool is posted and out to the buyer when the seller releases it. With a Kadena token it is one step: the token and the KDA swap in one transaction.",
      "steps": [
        [
          "The seller posts a pool",
          "A total amount of KDA, a minimum and maximum per trade, the price and the currency. For USDT or USDC, also the network and the address to be paid at. The whole amount is locked in the escrow contract when the pool is posted."
        ],
        [
          "A buyer takes part of it",
          "Any amount between the minimum and maximum, with one approval in Linx. That amount is locked for the buyer at once: there is no accept or deposit step, and several buyers can take from the same pool at the same time."
        ],
        [
          "The buyer pays and taps \"I paid\"",
          "The exact amount in USDT or USDC, to the seller's address shown in the trade, on the network shown. Then \"I paid\" with the transaction hash or a screenshot."
        ],
        [
          "The seller releases the KDA",
          "After checking the money really arrived in their own wallet, the seller releases and the contract sends the KDA to the buyer."
        ]
      ],
      "deadlineH": "If a deadline passes",
      "deadlineP": "Each pool sets how long buyers have to pay, from 15 minutes to 24 hours. A buyer can cancel before paying. If the buyer does not mark it paid in time, they get 30 more minutes; after that the seller can take the KDA back. After the buyer marks it paid, the seller has 1 hour by default to release; if nobody releases in time, either side can open a dispute. These actions are on-chain transactions.",
      "wrongH": "If something goes wrong",
      "wrongP": "Either side can open a dispute from the trade. The arbiter named in the contract reviews the evidence both sides upload and records a decision on-chain: the KDA goes to the buyer, back to the seller, or is split between them.",
      "personH": "If you need a person",
      "personPre": "The Kadena Nexus team is in the ",
      "personLink": "Telegram group",
      "personPost": ". Ask there before, during, or after a trade, and we'll help you through it.",
      "watchCaption": "A full trade between two phones, inside Linx Wallet, from posting to the KDA arriving. Demo with sample accounts."
    },
    "compare": {
      "h2": "Escrow on Kadena or a centralized P2P desk",
      "p": "Both let you buy from another person. The difference is who holds the coins while you wait for the payment.",
      "ours": "Kadena P2P Marketplace",
      "theirs": "Centralized P2P desk",
      "rows": [
        [
          "Who holds the KDA during a trade",
          "A Pact contract on chain 1 or 2",
          "The platform"
        ],
        [
          "What you need to start",
          "Linx Wallet on your phone and an email",
          "An exchange account, usually with ID checks"
        ],
        [
          "Platform fee",
          "None, only network gas",
          "Set by the platform"
        ],
        [
          "Who settles disputes",
          "The arbiter named in the contract",
          "Platform support staff"
        ],
        [
          "Record of each step",
          "Public on Chainweb",
          "Kept by the platform"
        ]
      ],
      "note": "USDT and USDC payments happen between you and the other trader, outside the contract. Check the money has arrived before you release, and follow the rules that apply where you live. Payments in Kadena tokens (BRO, FLUX, kb-USDC, kb-ETH, kb-USDT) happen inside the contract."
    },
    "need": {
      "h2": "What you need before you start",
      "p": "Four things. No account and no identity check.",
      "items": [
        [
          "Linx Wallet on your phone",
          "The Marketplace is inside Linx Wallet: in Linx, open Explore → Web3 Apps → Kadena → Kadena P2P Marketplace, and approve each step without leaving the app. Your wallet is your account, and each step of a trade is one approval."
        ],
        [
          "KDA on the right chain, plus a little for gas",
          "USDT, USDC, BRO and FLUX trade on chain 1; kb-USDC, kb-ETH and kb-USDT on chain 2. The KDA you sell must be on the chain of the currency, and Linx Wallet can move KDA between chains. Each transaction costs under 0.0001 KDA, so 0.1 KDA on that chain covers dozens of trades. Your wallet may show your total across all chains; only the KDA on the trade's chain counts."
        ],
        [
          "A way to pay",
          "USDT or USDC (for example on Tron TRC20 or Ethereum ERC20), or one of the Kadena tokens BRO, FLUX, kb-USDC, kb-ETH or kb-USDT. Bank transfers and cash are not used. USDT and USDC are paid between the two of you, outside the contract; Kadena tokens are paid inside it, in the same transaction as the KDA."
        ],
        [
          "An email for trade notices",
          "Confirmed once with a link. Every step of your trades comes by email (when to pay or release, and before time runs out), like an exchange. Only you and the Marketplace see it."
        ]
      ]
    },
    "faq": {
      "h2": "Questions people ask before their first trade",
      "items": [
        [
          "Where is my KDA while the trade runs?",
          "In the escrow contract free.p2p-escrow-v11 on chain 1 or chain 2, not in anyone's wallet and not with Kadena Nexus. A seller's KDA is locked from the moment the pool is posted (in a buy pool, from the moment the seller takes a slice). The contract moves it only to the buyer on release, back to the seller when a pool is closed, its unsold part is withdrawn or the buyer does not pay, or where the arbiter decides in a dispute."
        ],
        [
          "Who is the arbiter and how do they decide?",
          "An arbiter account operated by Kadena Nexus is set in the contract; you can see its address on each trade. The arbiter can act only on disputed trades, looks at the evidence both sides upload, and the decision is recorded on-chain. It can send the KDA to the buyer, back to the seller, or split it."
        ],
        [
          "What does it cost?",
          "Nothing from the marketplace at launch. Each on-chain step is a normal Kadena transaction, under 0.0001 KDA in gas. The contract caps any future platform fee at 1%."
        ],
        [
          "Which chain does my KDA need to be on?",
          "It depends on the currency. USDT, USDC, BRO and FLUX are on chain 1; kb-USDC, kb-ETH and kb-USDT are on chain 2. If your KDA is on another chain, move it there first; Linx Wallet can do that."
        ],
        [
          "How do Kadena token payments work?",
          "With BRO, FLUX, kb-USDC, kb-ETH or kb-USDT, the token and the KDA swap in one transaction when you take. There is nothing to release and no waiting."
        ],
        [
          "Are there other kinds of pools?",
          "Yes. A buy pool says how much KDA someone wants to buy; sellers take slices of it, and their KDA is locked when they take. A free giveaway is a pool at price 0: whoever claims a slice gets it at once."
        ],
        [
          "What if the other side disappears?",
          "Nothing can be taken from you. If the buyer never pays, the payment window passes and the seller takes the KDA back. If the seller never releases after you paid, open a dispute with your payment proof and the arbiter settles it."
        ],
        [
          "Can I cancel or change a pool?",
          "You can top up a pool, withdraw the unsold part, or close it at any time; the unsold KDA comes back to you. A pool can also expire after 1, 3 or 7 days, or never. Slices already taken are separate trades: a buyer can cancel one before paying, and after that the KDA leaves escrow only by release, by the seller taking it back after a missed payment, or by the arbiter's decision."
        ],
        [
          "Why is there a 500 KDA limit?",
          "To keep first trades small. Until a wallet has 3 completed trades, each trade it takes part in is limited to 500 KDA. After that there is no limit, and cards stop showing \"New trader\"."
        ],
        [
          "What about trades from before this version?",
          "Trades on the earlier contract, free.p2p-escrow-v10, keep running until they finish and stay readable. Your reputation counts trades on both contracts."
        ],
        [
          "Can I use it on a computer?",
          "The Marketplace works on phones. On a computer you'll see a QR code that opens it on your phone."
        ]
      ]
    },
    "rules": {
      "h2": "Before your first trade",
      "items": [
        [
          "Posting a sell pool locks your KDA.",
          "The whole amount goes into the escrow contract when you post, so buyers can take from it at once. Close the pool or withdraw the unsold part at any time and it comes back to you."
        ],
        [
          "Each trade has a clock.",
          "The pool sets how long a buyer has to pay, from 15 minutes to 24 hours. After the buyer marks it paid, the seller has 1 hour by default to release. If time runs out, the contract allows a refund to the seller or a dispute, depending on the stage. These actions are on-chain transactions."
        ],
        [
          "Use the chat, but pay only to the address in the trade.",
          "Each trade has its own chat. The receiving address is set by the seller and shown in the trade; never pay to an address sent in chat."
        ],
        [
          "Act when it's your turn.",
          "You'll get an email and a notification. Pay and mark it paid, or release, without delay."
        ],
        [
          "Finished transactions can't be reversed.",
          "Check the payment has arrived in your own wallet before you release; a screenshot can be faked. If anything looks wrong, open a dispute instead of releasing."
        ]
      ]
    },
    "start": {
      "lead": "Connect Linx Wallet on your phone to see open pools and post your own.",
      "getWallet": "Get Linx Wallet",
      "connect": "Connect Linx",
      "questionsPre": "Questions first? Ask in the ",
      "tg": "Kadena Nexus Telegram group",
      "questionsPost": "."
    }
  },
  "ar": {
    "langName": "العربية",
    "switchTo": "English",
    "switchAria": "التبديل إلى الإنجليزية",
    "hero": {
      "h1": "تداول KDA من شخص إلى شخص، والعملات محفوظة في الضمان",
      "p": "مصمم لجوالك مع محفظة Linx. تُقفل عملات KDA الخاصة بالبائع في عقد Pact لحظة نشر عرضه، فعندما تأخذ جزءاً منه تبدأ الصفقة فوراً. ادفع بـ USDT أو USDC ويحرّر البائع العملات بعد وصول دفعتك، أو ادفع بـ BRO أو FLUX أو kb-USDC أو kb-ETH أو kb-USDT وتتم المبادلة فوراً. ويفصل المحكّم في النزاعات.",
      "try": "شاهد صفقة (دقيقتان)",
      "note": "لا حساب ولا تحقق من الهوية ولا رسوم منصة. تؤكد بريداً إلكترونياً لإشعارات الصفقات، وتدفع فقط رسوم شبكة Kadena."
    },
    "stats": {
      "openOffers": "عرضاً مفتوحاً الآن",
      "completedTrades": "صفقة مكتملة",
      "kdaSettled": "KDA تمت تسويتها عبر الضمان",
      "sample": "أرقام توضيحية"
    },
    "example": {
      "title": "صفقة توضيحية",
      "amount": "يأخذ المشتري",
      "price": "السعر",
      "perKda": "لكل KDA",
      "buyerPays": "يدفع المشتري",
      "payWith": "طريقة الدفع",
      "payWithValue": "USDT على Tron",
      "left": "متبقٍ",
      "done": "تم",
      "steps": [
        [
          "OPEN",
          "نُشر العرض",
          "نشر البائع عرضاً بـ 500 KDA، وقُفلت الكمية كلها في عقد الضمان فوراً"
        ],
        [
          "TAKEN",
          "تم الأخذ",
          "أخذ مشترٍ 200 KDA، فقُفلت له فوراً، وبقيت 300 KDA في العرض لغيره"
        ],
        [
          "PAID",
          "تم الدفع",
          "أرسل المشتري 1.92 USDT على Tron إلى العنوان الظاهر في الصفقة، وضغط \"دفعت\" مع رمز المعاملة (hash)"
        ],
        [
          "COMPLETED",
          "تم التحرير",
          "تأكد البائع من وصول USDT وحرّر 200 KDA للمشتري"
        ]
      ]
    },
    "facts": {
      "contract": "عقد الضمان",
      "chain": "السلسلتان 1 و2، شبكة Kadena الرئيسية",
      "view": "اطّلع على كود العقد",
      "review": "مهل الصفقة",
      "reviewSub": "للدفع، يحددها كل عرض · ثم ساعة للتحرير",
      "bounty": "المتداولون الجدد",
      "bountyValue": "500 KDA",
      "bountySub": "لكل صفقة، حتى إكمال 3 صفقات",
      "fee": "رسوم المنصة",
      "feeValue": "لا توجد",
      "feeSub": "فقط رسوم الشبكة، أقل من 0.0001 KDA لكل معاملة، والعقد يحدد سقف أي رسوم مستقبلية بـ 1%"
    },
    "how": {
      "h2": "كيف تتم الصفقة",
      "p": "أربع خطوات عند الدفع بـ USDT أو USDC، كل منها مسجلة على Chainweb. تدخل عملات KDA الضمان عند نشر العرض، وتخرج إلى المشتري عندما يحرّرها البائع. ومع رموز Kadena تكفي خطوة واحدة: تُبادَل الرموز بعملات KDA في معاملة واحدة.",
      "steps": [
        [
          "ينشر البائع عرضاً",
          "كمية إجمالية من KDA، وحد أدنى وأقصى لكل صفقة، والسعر، والعملة. ومع USDT أو USDC يحدد أيضاً الشبكة والعنوان الذي يستلم عليه. تُقفل الكمية كلها في عقد الضمان عند نشر العرض."
        ],
        [
          "يأخذ المشتري جزءاً منه",
          "أي كمية بين الحد الأدنى والأقصى، بموافقة واحدة في Linx. تُقفل هذه الكمية للمشتري فوراً: لا توجد خطوة قبول ولا إيداع، ويمكن لعدة مشترين الأخذ من العرض نفسه في الوقت نفسه."
        ],
        [
          "يدفع المشتري ويضغط \"دفعت\"",
          "المبلغ الدقيق بـ USDT أو USDC، إلى عنوان البائع الظاهر في الصفقة وعلى الشبكة المحددة فيها. ثم يضغط \"دفعت\" ويضيف رمز المعاملة أو لقطة شاشة."
        ],
        [
          "يحرّر البائع عملات KDA",
          "بعد أن يتأكد البائع من وصول المبلغ فعلاً إلى محفظته، يحرّر العملات ويرسلها العقد إلى المشتري."
        ]
      ],
      "deadlineH": "إذا انتهت المهلة",
      "deadlineP": "يحدد كل عرض مهلة الدفع للمشترين، من 15 دقيقة إلى 24 ساعة. يستطيع المشتري الإلغاء قبل الدفع، وإذا لم يؤشّر على الدفع في الوقت المحدد يستطيع البائع استرداد عملاته. وبعد تأشير الدفع، أمام البائع ساعة واحدة افتراضياً للتحرير، وإذا لم يحرّر أحد في الوقت المحدد يستطيع أي طرف فتح نزاع. هذه الإجراءات معاملات على السلسلة.",
      "wrongH": "إذا حدث خطأ",
      "wrongP": "يستطيع أي طرف فتح نزاع من داخل الصفقة. يراجع المحكّم المذكور في العقد الأدلة التي يرفعها الطرفان ويسجّل قراراً على السلسلة: إرسال عملات KDA إلى المشتري، أو إعادتها إلى البائع، أو تقسيمها بينهما.",
      "personH": "إذا احتجت إلى شخص",
      "personPre": "فريق Kadena Nexus موجود في ",
      "personLink": "مجموعة تيليجرام",
      "personPost": ". اسأل هناك قبل الصفقة أو أثناءها أو بعدها، وسنساعدك خطوة بخطوة.",
      "watchCaption": "صفقة كاملة بين هاتفين من داخل محفظة Linx، من النشر حتى وصول KDA. عرض توضيحي بحسابات تجريبية (الشرح في الفيديو بالإنجليزية)."
    },
    "compare": {
      "h2": "ضمان على Kadena أم منصة P2P مركزية",
      "p": "كلاهما يتيح لك الشراء من شخص آخر. الفرق هو من يحتفظ بالعملات بينما تنتظر الدفع.",
      "ours": "Kadena P2P Marketplace",
      "theirs": "منصة P2P مركزية",
      "rows": [
        [
          "من يحتفظ بـ KDA أثناء الصفقة",
          "عقد Pact على السلسلة 1 أو 2",
          "المنصة"
        ],
        [
          "ما تحتاجه للبدء",
          "محفظة Linx على جوالك وبريد إلكتروني",
          "حساب في منصة تداول، غالباً مع التحقق من الهوية"
        ],
        [
          "رسوم المنصة",
          "لا توجد، فقط رسوم الشبكة",
          "تحددها المنصة"
        ],
        [
          "من يفصل في النزاعات",
          "المحكّم المذكور في العقد",
          "موظفو دعم المنصة"
        ],
        [
          "سجل كل خطوة",
          "علني على Chainweb",
          "تحتفظ به المنصة"
        ]
      ],
      "note": "تتم مدفوعات USDT وUSDC بينك وبين المتداول الآخر، خارج العقد. تأكد من وصول المبلغ قبل التحرير، والتزم بالأنظمة المعمول بها في بلدك. أما الدفع برموز Kadena ‏(BRO وFLUX وkb-USDC وkb-ETH وkb-USDT) فيتم داخل العقد."
    },
    "need": {
      "h2": "ما تحتاجه قبل البدء",
      "p": "أربعة أشياء. لا حساب ولا تحقق من الهوية.",
      "items": [
        [
          "محفظة Linx على جوالك",
          "السوق موجود داخل محفظة Linx: في Linx افتح Explore ← Web3 Apps ← Kadena ← Kadena P2P Marketplace، ووافق على كل خطوة دون مغادرة التطبيق. المحفظة هي حسابك، وكل خطوة في الصفقة موافقة واحدة."
        ],
        [
          "عملات KDA على السلسلة الصحيحة، وقليل منها لرسوم الشبكة",
          "يتم التداول بـ USDT وUSDC وBRO وFLUX على السلسلة 1، وبـ kb-USDC وkb-ETH وkb-USDT على السلسلة 2. يجب أن تكون عملات KDA التي تبيعها على سلسلة العملة، ويمكن لمحفظة Linx نقلها بين السلاسل. كل معاملة تكلف أقل من 0.0001 KDA، لذا 0.1 KDA على تلك السلسلة تكفي لعشرات الصفقات. قد تعرض محفظتك مجموع رصيدك على كل السلاسل؛ هنا يُحتسب فقط رصيدك على سلسلة الصفقة."
        ],
        [
          "طريقة للدفع",
          "USDT أو USDC (مثلاً على Tron TRC20 أو Ethereum ERC20)، أو أحد رموز Kadena: BRO أو FLUX أو kb-USDC أو kb-ETH أو kb-USDT. لا نستخدم التحويلات البنكية ولا النقد. يتم دفع USDT وUSDC بينكما خارج العقد، أما رموز Kadena فتُدفع داخله في المعاملة نفسها مع KDA."
        ],
        [
          "بريد إلكتروني لإشعارات الصفقات",
          "تؤكده مرة واحدة برابط. تصلك كل خطوة من صفقاتك بالبريد (متى تدفع أو تحرّر، وقبل انتهاء المهلة)، كما في منصات التداول. لا يراه غيرك وغير السوق."
        ]
      ]
    },
    "faq": {
      "h2": "أسئلة يطرحها الناس قبل صفقتهم الأولى",
      "items": [
        [
          "أين تكون عملات KDA الخاصة بي أثناء الصفقة؟",
          "في عقد الضمان free.p2p-escrow-v11 على السلسلة 1 أو 2، ليس في محفظة أي شخص ولا لدى Kadena Nexus. تُقفل عملات البائع لحظة نشر العرض (وفي عرض الشراء، لحظة أخذ البائع حصته منه). لا يحرّكها العقد إلا إلى المشتري عند التحرير، أو إلى البائع عند إغلاق العرض أو سحب الجزء غير المباع أو عدم دفع المشتري، أو حسب قرار المحكّم في حالة النزاع."
        ],
        [
          "من هو المحكّم وكيف يقرر؟",
          "حساب محكّم يديره فريق Kadena Nexus ومحدد في العقد، ويمكنك رؤية عنوانه في كل صفقة. لا يستطيع المحكّم التصرف إلا في الصفقات المتنازع عليها، ويراجع الأدلة التي يرفعها الطرفان، ويُسجَّل القرار على السلسلة. ويمكنه إرسال عملات KDA إلى المشتري أو إعادتها إلى البائع أو تقسيمها بينهما."
        ],
        [
          "كم التكلفة؟",
          "لا شيء من السوق عند الإطلاق. كل خطوة على السلسلة هي معاملة Kadena عادية، برسوم أقل من 0.0001 KDA. ويحدد العقد سقف أي رسوم منصة مستقبلية بـ 1%."
        ],
        [
          "على أي سلسلة يجب أن تكون عملات KDA؟",
          "حسب العملة. USDT وUSDC وBRO وFLUX على السلسلة 1، وkb-USDC وkb-ETH وkb-USDT على السلسلة 2. إذا كانت عملاتك على سلسلة أخرى، انقلها إليها أولاً، ويمكن لمحفظة Linx فعل ذلك."
        ],
        [
          "كيف يتم الدفع برموز Kadena؟",
          "مع BRO أو FLUX أو kb-USDC أو kb-ETH أو kb-USDT، تُبادَل الرموز بعملات KDA في معاملة واحدة عند الأخذ. لا حاجة إلى تحرير ولا انتظار."
        ],
        [
          "هل توجد أنواع أخرى من العروض؟",
          "نعم. عرض الشراء يحدد كمية KDA التي يريد صاحبه شراءها، ويأخذ البائعون حصصاً منه، وتُقفل عملاتهم عند الأخذ. والهدية المجانية عرض بسعر صفر: من يطلب حصة يحصل عليها فوراً."
        ],
        [
          "ماذا لو اختفى الطرف الآخر؟",
          "لا يمكن أخذ شيء منك. إذا لم يدفع المشتري، تنتهي مهلة الدفع ويسترد البائع عملاته. وإذا لم يحرّر البائع بعد أن دفعت، افتح نزاعاً مع إثبات الدفع ويفصل فيه المحكّم."
        ],
        [
          "هل يمكنني إلغاء العرض أو تعديله؟",
          "يمكنك زيادة كمية العرض، أو سحب الجزء غير المباع، أو إغلاقه في أي وقت، وتعود إليك عملات KDA غير المباعة. ويمكن أن ينتهي العرض بعد يوم أو 3 أيام أو 7 أيام، أو لا ينتهي. أما الحصص المأخوذة فهي صفقات مستقلة: يستطيع المشتري إلغاء صفقته قبل الدفع، وبعدها لا تخرج عملات KDA من الضمان إلا بالتحرير، أو باسترداد البائع لها إذا لم يدفع المشتري في الوقت المحدد، أو بقرار المحكّم."
        ],
        [
          "لماذا يوجد حد 500 KDA؟",
          "لتبقى الصفقات الأولى صغيرة. إلى أن تكمل المحفظة 3 صفقات، تكون كل صفقة تشارك فيها بحد أقصى 500 KDA. بعد ذلك لا يوجد حد، ولا تظهر عبارة \"متداول جديد\" على بطاقاتها."
        ],
        [
          "وماذا عن الصفقات التي بدأت قبل هذا الإصدار؟",
          "الصفقات على العقد السابق free.p2p-escrow-v10 تستمر حتى تنتهي، ويبقى بالإمكان الاطلاع عليها. وتجمع سمعتك صفقاتك على العقدين."
        ],
        [
          "هل يمكنني استخدامه على الكمبيوتر؟",
          "السوق يعمل على الجوال. على الكمبيوتر سترى رمز QR يفتحه على جوالك."
        ]
      ]
    },
    "rules": {
      "h2": "قبل صفقتك الأولى",
      "items": [
        [
          "نشر عرض بيع يقفل عملاتك.",
          "تدخل الكمية كلها عقد الضمان عند النشر، ليتمكن المشترون من الأخذ منها فوراً. أغلق العرض أو اسحب الجزء غير المباع في أي وقت وتعود إليك."
        ],
        [
          "لكل صفقة مهلة.",
          "يحدد العرض مهلة دفع المشتري، من 15 دقيقة إلى 24 ساعة. وبعد تأشير الدفع، أمام البائع ساعة واحدة افتراضياً للتحرير. عند انتهاء المهلة، يسمح العقد باسترداد البائع لعملاته أو بفتح نزاع، بحسب مرحلة الصفقة. وهذه الإجراءات معاملات على السلسلة."
        ],
        [
          "استخدم المحادثة، لكن ادفع فقط إلى العنوان الظاهر في الصفقة.",
          "لكل صفقة محادثتها الخاصة. عنوان الاستلام يحدده البائع ويظهر داخل الصفقة؛ لا تدفع أبداً إلى عنوان يُرسل في المحادثة."
        ],
        [
          "تصرّف عندما يأتي دورك.",
          "سيصلك بريد وإشعار. ادفع وأشّر على الدفع، أو حرّر، دون تأخير."
        ],
        [
          "الصفقات المكتملة لا يمكن عكسها.",
          "تأكد من وصول الدفعة إلى محفظتك قبل التحرير؛ فلقطة الشاشة يمكن تزويرها. إذا بدا أي شيء خاطئاً، افتح نزاعاً بدلاً من التحرير."
        ]
      ]
    },
    "start": {
      "lead": "اربط محفظة Linx على جوالك لترى العروض المفتوحة وتنشر عرضك.",
      "getWallet": "احصل على محفظة Linx",
      "connect": "اربط Linx",
      "questionsPre": "لديك أسئلة أولاً؟ اسأل في ",
      "tg": "مجموعة Kadena Nexus على تيليجرام",
      "questionsPost": "."
    }
  }
};

const LANG_KEY = "nx-lang";
const LANG_EVENT = "nx-lang-change";

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "ar") return saved;
    } catch {
      /* storage unavailable */
    }
    return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
  });
  // every part of the page that reads the language follows a switch (header, landing, buttons)
  useEffect(() => {
    const on = (e: Event) => setLangState((e as CustomEvent<Lang>).detail);
    window.addEventListener(LANG_EVENT, on);
    return () => window.removeEventListener(LANG_EVENT, on);
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: l }));
  };
  return [lang, setLang];
}

const DEADLINE = 14 * 60 + 52;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function ExampleTrade({ t }: { t: Copy["example"] }) {
  const [i, setI] = useState(1);
  const [left, setLeft] = useState(DEADLINE);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tick = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    const step = window.setInterval(() => {
      setI((n) => (n + 1) % t.steps.length);
      setLeft(DEADLINE);
    }, 2600);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(step);
    };
  }, [t.steps.length]);

  const last = t.steps.length - 1;
  const done = i === last;

  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6" aria-label={t.title}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{t.title}</span>
        <span
          dir="ltr"
          className={
            "rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.08em] " +
            (done ? "border-primary/40 bg-primary/10 text-primary" : "border-accent/40 bg-accent/10 text-accent")
          }
        >
          {t.steps[i][0]}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border pb-5 text-sm">
        <div>
          <dt className="text-muted-foreground">{t.amount}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">200 KDA</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.price}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">
            $0.0096 <span className="font-sans text-sm font-normal text-muted-foreground">{t.perKda}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.buyerPays}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">1.92 USDT</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.payWith}</dt>
          <dd className="font-display text-lg font-semibold">{t.payWithValue}</dd>
        </div>
      </dl>

      <ol className="mt-5 grid gap-0">
        {t.steps.map(([chip, title, note], k) => {
          const isNow = k === i && !done;
          const isDone = k < i || (k === i && done);
          const dot = isDone ? "border-primary bg-primary" : isNow ? "border-accent bg-accent nx-pulse" : "border-border bg-background";
          return (
            <li key={chip} className="grid grid-cols-[1.25rem_1fr_5.5rem] gap-x-3">
              <span className="flex flex-col items-center">
                <span className={"mt-1 h-3 w-3 rounded-full border-2 transition-colors " + dot} />
                {k < last && <span className={"mt-1 w-0.5 flex-1 transition-colors " + (k < i ? "bg-primary" : "bg-border")} />}
              </span>
              <span className={k < last ? "pb-4" : ""}>
                <b className="block font-semibold">{title}</b>
                <span className="text-sm text-muted-foreground">{note}</span>
              </span>
              {/* fixed width, so the text beside it never rewraps as the steps change (the card keeps its size) */}
              <span className="whitespace-nowrap pt-0.5 text-end text-xs tabular-nums text-muted-foreground">
                {isNow ? `${fmt(left)} ${t.left}` : k < i ? t.done : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Phone walkthrough: a full trade between two phones (recorded in the demo with sample accounts). */
const WALKTHROUGH_VIDEO = "/marketplace-walkthrough.mp4";
const WALKTHROUGH_POSTER = "/marketplace-walkthrough.jpg";

export type NexusLandingProps = {
  walletAction: ReactNode;
  /** Link to the contract source (GitHub file or explorer page). The "View the contract source" link hides when empty. */
  contractUrl?: string;
  /** Arrived from an offer alert email while not connected: say why to connect. */
  fromAlert?: boolean;
};

export default function NexusLanding({ walletAction, contractUrl, fromAlert }: NexusLandingProps) {
  const [lang, setLang] = useLang();
  const t = COPY[lang];
  const rtl = lang === "ar";
  const h2 = "font-display text-[clamp(1.8rem,3vw,2.5rem)] font-semibold leading-tight";
  const link = "font-semibold text-primary hover:underline";

  return (
    <div className="font-sans text-foreground" dir={rtl ? "rtl" : "ltr"} lang={lang}>
      {fromAlert && (
        <div className="border-b border-primary/30 bg-primary/10">
          <p className="mx-auto max-w-6xl px-5 py-3 text-sm font-medium">{ALERTS_COPY[lang].offerNotice}</p>
        </div>
      )}
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setLang(rtl ? "en" : "ar")}
            aria-label={t.switchAria}
            className="mb-6 inline-flex h-8 items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <span aria-hidden="true">{rtl ? "EN" : "ع"}</span>
            {t.switchTo}
          </button>
          <h1 className="font-display text-[clamp(2.3rem,5vw,3.9rem)] font-bold leading-[1.08] tracking-[-0.02em]">{t.hero.h1}</h1>
          <p className="mt-5 max-w-[36rem] text-lg leading-relaxed text-muted-foreground">{t.hero.p}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {walletAction}
            <a href="#watch" className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 font-semibold text-foreground hover:border-primary">
              <span aria-hidden="true" className="text-xs text-primary">▶</span>{t.hero.try}
            </a>
          </div>
          <OfferAlertsButton lang={lang} variant="secondary" className="mt-3 h-11 rounded-full px-5" />
          <p className="mt-5 text-sm text-muted-foreground">{t.hero.note}</p>
        </div>
        <ExampleTrade t={t.example} />
      </section>

      {/* Contract facts */}
      <section className="border-y border-border bg-secondary/60" aria-label={t.facts.contract}>
        <dl className="mx-auto grid max-w-6xl grid-cols-1 px-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-border py-5 sm:pe-6 lg:border-e">
            <dt className="text-sm text-muted-foreground">{t.facts.contract}</dt>
            <dd dir="ltr" className="mt-1 font-mono text-[0.95rem]">free.p2p-escrow-v11</dd>
            <dd className="text-sm text-muted-foreground">{t.facts.chain}</dd>
            {contractUrl && (
              <dd className="mt-1 text-sm">
                <a href={contractUrl} target="_blank" rel="noreferrer" className={link}>
                  {t.facts.view}
                </a>
              </dd>
            )}
          </div>
          <div className="border-t border-border py-5 sm:border-t-0 sm:ps-6 lg:border-e lg:px-6">
            <dt className="text-sm text-muted-foreground">{t.facts.review}</dt>
            <dd dir="ltr" className="mt-1 font-display text-2xl font-bold tabular-nums">15 min–24 h</dd>
            <dd className="text-sm text-muted-foreground">{t.facts.reviewSub}</dd>
          </div>
          <div className="border-t border-border py-5 sm:pe-6 lg:border-e lg:border-t-0 lg:px-6">
            <dt className="text-sm text-muted-foreground">{t.facts.bounty}</dt>
            <dd dir="ltr" className="mt-1 font-display text-2xl font-bold tabular-nums text-accent">{t.facts.bountyValue}</dd>
            <dd className="text-sm text-muted-foreground">{t.facts.bountySub}</dd>
          </div>
          <div className="border-t border-border py-5 sm:ps-6 lg:border-t-0">
            <dt className="text-sm text-muted-foreground">{t.facts.fee}</dt>
            <dd className="mt-1 font-display text-2xl font-bold">{t.facts.feeValue}</dd>
            <dd className="text-sm text-muted-foreground">{t.facts.feeSub}</dd>
          </div>
        </dl>
      </section>

      {/* How a trade works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="grid gap-4 lg:grid-cols-[5fr_7fr] lg:items-end lg:gap-16">
          <h2 className={h2}>{t.how.h2}</h2>
          <p className="max-w-[38rem] text-muted-foreground">{t.how.p}</p>
        </div>
        <figure id="watch" className="mx-auto mt-10 w-full max-w-[340px] scroll-mt-24">
          <video
            src={WALKTHROUGH_VIDEO}
            poster={WALKTHROUGH_POSTER}
            controls
            playsInline
            preload="none"
            className="aspect-[9/16] w-full rounded-2xl border border-border bg-[#123A48] shadow-sm"
          />
          <figcaption className="mt-3 text-center text-sm text-muted-foreground">{t.how.watchCaption}</figcaption>
        </figure>
        <div className="mt-10 grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-16">
          <ol className="grid border-t border-border">
            {t.how.steps.map(([title, d], k) => (
              <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-border py-5">
                <span className="font-display text-xl font-bold text-primary">{k + 1}</span>
                <span>
                  <b className="font-semibold">{title}</b>
                  <span className="mt-1 block text-muted-foreground">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="grid content-start gap-8">
            <div>
              <h3 className="font-display text-lg font-semibold">{t.how.deadlineH}</h3>
              <p className="mt-2 text-muted-foreground">{t.how.deadlineP}</p>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">{t.how.wrongH}</h3>
              <p className="mt-2 text-muted-foreground">{t.how.wrongP}</p>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">{t.how.personH}</h3>
              <p className="mt-2 text-muted-foreground">
                {t.how.personPre}
                <a href="https://t.me/KadenaNexus" target="_blank" rel="noreferrer" className={link}>
                  {t.how.personLink}
                </a>
                {t.how.personPost}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid gap-4 lg:grid-cols-[5fr_7fr] lg:items-end lg:gap-16">
            <h2 className={h2}>{t.compare.h2}</h2>
            <p className="max-w-[38rem] text-muted-foreground">{t.compare.p}</p>
          </div>
          {/* phones: one card per question, both answers stacked */}
          <dl className="mt-8 grid gap-3 sm:hidden">
            {t.compare.rows.map(([row, ours, theirs]) => (
              <div key={row} className="rounded-lg border border-border p-4">
                <dt className="text-sm font-medium text-muted-foreground">{row}</dt>
                <dd className="mt-2 border-s-2 border-primary ps-3">
                  <span className="block text-xs font-semibold text-primary">{t.compare.ours}</span>
                  <span className="font-medium">{ours}</span>
                </dd>
                <dd className="mt-2 border-s-2 border-border ps-3 text-muted-foreground">
                  <span className="block text-xs font-semibold">{t.compare.theirs}</span>
                  {theirs}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-10 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[40rem] border-collapse text-start">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th className="py-3 pe-6 text-start font-medium" />
                  <th className="py-3 pe-6 text-start font-semibold text-foreground">{t.compare.ours}</th>
                  <th className="py-3 text-start font-medium">{t.compare.theirs}</th>
                </tr>
              </thead>
              <tbody>
                {t.compare.rows.map(([row, ours, theirs]) => (
                  <tr key={row} className="border-b border-border">
                    <th className="py-4 pe-6 text-start font-medium text-muted-foreground">{row}</th>
                    <td className="py-4 pe-6 font-medium">{ours}</td>
                    <td className="py-4 text-muted-foreground">{theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-[46rem] text-sm text-muted-foreground">{t.compare.note}</p>
        </div>
      </section>

      {/* What you need */}
      <section id="need" className="border-t border-border bg-secondary/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[5fr_7fr] lg:gap-16 lg:py-20">
          <div className="min-w-0">
            <h2 className={h2}>{t.need.h2}</h2>
            <p className="mt-4 max-w-[36rem] text-muted-foreground">{t.need.p}</p>
          </div>
          <ol className="grid gap-4">
            {t.need.items.map(([title, d], k) => (
              <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-3 rounded-lg border border-border bg-card p-5">
                <span className="font-display text-xl font-bold text-primary">{k + 1}</span>
                <span>
                  <b className="font-semibold">{title}</b>
                  <span className="mt-1 block text-muted-foreground">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[5fr_7fr] lg:gap-16 lg:py-20">
          <h2 className={h2}>{t.faq.h2}</h2>
          <div className="grid border-t border-border">
            {t.faq.items.map(([q, a]) => (
              <details key={q} className="group border-b border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden="true" className="text-xl leading-none text-primary transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Before your first trade + start */}
      <section id="start" className="border-t border-border bg-secondary/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[7fr_5fr] lg:gap-16 lg:py-20">
          <div className="min-w-0">
            <h2 className={h2}>{t.rules.h2}</h2>
            <ul className="mt-6 grid gap-4 text-muted-foreground">
              {t.rules.items.map(([b, rest]) => (
                <li key={b} className="grid grid-cols-[1rem_1fr] gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-primary" />
                  <span>
                    <b className="font-semibold text-foreground">{b}</b> {rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 self-center">
            <p className="font-display text-xl font-semibold">{t.start.lead}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {walletAction}
              <a
                href={linxStoreLink()}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center rounded-full border border-border px-5 font-semibold text-foreground hover:border-primary"
              >
                {t.start.getWallet}
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {t.start.questionsPre}
              <a href="https://t.me/KadenaNexus" target="_blank" rel="noreferrer" className={link}>
                {t.start.tg}
              </a>
              {t.start.questionsPost}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
