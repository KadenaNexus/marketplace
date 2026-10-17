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
//     contractUrl="https://github.com/.../p2p-escrow-v10.pact" // optional, see README
//   />
//
// The header and footer stay in their own components (see 4-copy-changes.md). The language
// pill rendered at the top of the hero can be moved into the header if you prefer; it only
// needs `lang` and `setLang` (export `useLang` below).

import { ReactNode, useEffect, useState } from "react";
import { OfferAlertsButton } from "@/components/OfferAlerts";
import { linxStoreLink, OpenInLinxCard } from "@/components/OpenInLinx";
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
      "p": "Made for your phone with Linx Wallet. Pick an offer, pay by USDT, USDC, Wise, Revolut or BRO, and the seller's KDA stays locked in a Pact contract on Chain 1 until they confirm your payment. An arbiter settles it if something goes wrong.",
      "try": "Watch a trade (2 min)",
      "note": "No account, no ID check and no platform fee. You confirm an email for trade notices and pay only Kadena network gas."
    },
    "stats": {
      "openOffers": "open offers right now",
      "completedTrades": "completed trades",
      "kdaSettled": "KDA settled through escrow",
      "sample": "sample figures"
    },
    "example": {
      "title": "Example trade",
      "amount": "Amount",
      "price": "Price",
      "perKda": "per KDA",
      "buyerPays": "Buyer pays",
      "payWith": "Pay with",
      "payWithValue": "USDT, Wise",
      "left": "left",
      "done": "done",
      "steps": [
        [
          "CREATED",
          "Created",
          "Seller posted the offer. Nothing is held and no trade clock is running yet; it stays listed for 7 days"
        ],
        [
          "ACCEPTED",
          "Accepted",
          "A buyer accepted it. The seller now has 1 hour to fund"
        ],
        [
          "FUNDED",
          "Funded",
          "500 KDA locked in the escrow contract"
        ],
        [
          "PAID",
          "Paid",
          "Buyer sent $4.80 by Wise and marked it paid, with a screenshot as proof"
        ],
        [
          "COMPLETED",
          "Completed",
          "Seller confirmed the money and released the KDA"
        ]
      ]
    },
    "facts": {
      "contract": "Escrow contract",
      "chain": "Chain 1, Kadena mainnet",
      "view": "View the contract source",
      "review": "Escrow deadlines",
      "reviewSub": "fund · mark paid · release",
      "bounty": "New traders",
      "bountyValue": "500 KDA",
      "bountySub": "per trade, until 3 completed trades",
      "fee": "Platform fee",
      "feeValue": "None",
      "feeSub": "only network gas, under 0.0001 KDA per transaction"
    },
    "how": {
      "h2": "How a trade works",
      "p": "Five steps, each recorded on Chainweb. The KDA moves only twice: into escrow when the seller funds the trade, and out to the buyer when the seller releases it.",
      "steps": [
        [
          "The seller posts an offer",
          "Amount, price per KDA, the payment methods they accept and where they want to be paid."
        ],
        [
          "A buyer accepts it",
          "Anyone can chat with the seller about an offer before accepting. Accepting is one approval in Linx."
        ],
        [
          "The seller funds the escrow",
          "Their KDA is now locked in the contract. Neither side can move it alone. The buyer gets an email and a notification."
        ],
        [
          "The buyer pays and marks it paid",
          "The exact amount, to the payment details shown in the trade, by USDT, USDC, Wise, Revolut or BRO. Then a screenshot of the transfer as proof."
        ],
        [
          "The seller releases the KDA",
          "After checking the money really arrived in their own account, the seller releases and the contract sends the KDA to the buyer."
        ]
      ],
      "deadlineH": "If a deadline passes",
      "deadlineP": "After acceptance, the seller can close an unfunded trade if 1 hour passes. After funding, the seller can refund if the buyer does not mark payment within 4 hours. If the seller does not release within 1 hour after payment is marked, the trade can move to a dispute for arbiter review. These timeout actions require an on-chain transaction.",
      "wrongH": "If something goes wrong",
      "wrongP": "Either side can open a dispute from the trade. The arbiter named in the contract reviews the evidence both sides upload and records a decision on-chain, sending the KDA to the buyer or back to the seller.",
      "personH": "If you need a person",
      "personPre": "The Kadena Nexus team is in the ",
      "personLink": "Telegram group",
      "personPost": ". Ask there before, during, or after a trade, and we'll help you through it.",
      "watchCaption": "A full trade between two phones, inside Linx Wallet, from posting the offer to the KDA arriving. Demo with sample accounts."
    },
    "compare": {
      "h2": "Escrow on Kadena or a centralized P2P desk",
      "p": "Both let you buy from another person. The difference is who holds the coins while you wait for the payment.",
      "ours": "Kadena P2P Marketplace",
      "theirs": "Centralized P2P desk",
      "rows": [
        [
          "Who holds the KDA during a trade",
          "A Pact contract on Chain 1",
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
      "note": "Payments by USDT, USDC, Wise, Revolut or BRO happen between you and the other trader, outside the contract. Check the money has arrived before you release, and follow the rules that apply where you live."
    },
    "need": {
      "h2": "What you need before you start",
      "p": "Four things. No account and no identity check.",
      "items": [
        [
          "Linx Wallet on your phone",
          "The Marketplace is inside Linx Wallet: in Linx, open Explore → Web3 Apps → Kadena → Kadena P2P Marketplace, and approve each step without leaving the app. You can also open marketplace.kadena.ws in your phone's browser and connect Linx. Your wallet is your account, and each step of a trade is one approval."
        ],
        [
          "A little KDA on Chain 1 for gas",
          "Each transaction costs under 0.0001 KDA, so 0.1 KDA covers dozens of trades. Sellers also need the KDA they want to sell on Chain 1. Your wallet may show your total across all chains; only the KDA on Chain 1 counts here."
        ],
        [
          "A payment method the other side accepts",
          "USDT, USDC, Wise, Revolut or BRO, whichever the offer lists. Bank transfers are not used. The payment happens between the two of you, outside the contract."
        ],
        [
          "An email for trade notices",
          "Confirmed once with a link. Every step of your trades comes by email (when to fund, pay or release, and before time runs out), like an exchange. Only you and the Marketplace see it."
        ]
      ]
    },
    "faq": {
      "h2": "Questions people ask before their first trade",
      "items": [
        [
          "Where is my KDA while the trade runs?",
          "In the escrow contract free.p2p-escrow-v10 on Chain 1, not in anyone's wallet and not with Kadena Nexus. The contract only moves it to the buyer when the seller releases, back to the seller on a refund, or where the arbiter decides in a dispute."
        ],
        [
          "Who is the arbiter and how do they decide?",
          "An arbiter account operated by Kadena Nexus is written into every escrow when it is created; you can see its address on each trade. The arbiter can act only on trades that are disputed or timed out, looks at the evidence both sides upload, and the decision is recorded on-chain."
        ],
        [
          "What does it cost?",
          "Nothing from the marketplace. Each on-chain step is a normal Kadena transaction, under 0.0001 KDA in gas."
        ],
        [
          "Which chain does my KDA need to be on?",
          "Chain 1. If your KDA is on another chain, move it there first with your wallet's cross-chain transfer."
        ],
        [
          "What if the other side disappears?",
          "Nothing can be taken from you. If the buyer never funds or pays, the deadline passes and the seller closes the trade or takes the refund. If the seller never releases after you paid, open a dispute with your payment proof and the arbiter settles it."
        ],
        [
          "Can I cancel?",
          "Before anyone accepts, delete your offer at any time; it holds nothing. After acceptance, cancellation follows the trade rules: a seller who has not funded yet can cancel, and once funded the KDA only leaves escrow by release, refund, or the arbiter's decision."
        ],
        [
          "Why is there a 500 KDA limit?",
          "To keep first trades small. Until a wallet has 3 completed trades, each offer it creates or accepts is limited to 500 KDA. After that there is no limit, and offer cards stop showing \"New trader\"."
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
          "Posting an offer is free and holds nothing.",
          "No KDA or money moves when you create or browse offers. The escrow only takes the seller's KDA once a trade is accepted and the seller chooses to fund it."
        ],
        [
          "An open offer stays listed for 7 days.",
          "If nobody accepts it by then, it leaves the market and you get a notification: list it again with one tap, or delete it. The trade time limits only start once someone accepts: 1 hour to fund, 4 hours to mark the payment, 1 hour to release. If a deadline passes, the contract allows a close, refund or dispute transition depending on the trade stage. These timeout actions require an on-chain transaction."
        ],
        [
          "Ask questions in the chat, but pay only to the trade's details.",
          "You can message the creator of any offer before accepting. Where to pay is set by the seller and shown in the trade; never pay to other details sent in chat."
        ],
        [
          "Act when it's your turn.",
          "You'll get an email and a notification. Fund, mark as paid, or release without delay."
        ],
        [
          "Finished transactions can't be reversed.",
          "Check the payment has arrived in your own account before you release; a screenshot can be faked. If anything looks wrong, open a dispute instead of releasing."
        ]
      ]
    },
    "start": {
      "lead": "Connect Linx Wallet on your phone to see open offers and post your own.",
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
      "p": "مصمم لجوالك مع محفظة Linx. اختر عرضاً وادفع عبر USDT أو USDC أو Wise أو Revolut أو BRO، وتبقى عملات KDA الخاصة بالبائع مقفلة في عقد Pact على السلسلة 1 حتى يؤكد استلام دفعتك. ويتدخل المحكّم لتسوية الأمر إذا حدث خطأ.",
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
      "amount": "الكمية",
      "price": "السعر",
      "perKda": "لكل KDA",
      "buyerPays": "يدفع المشتري",
      "payWith": "طريقة الدفع",
      "payWithValue": "USDT أو Wise",
      "left": "متبقٍ",
      "done": "تم",
      "steps": [
        [
          "CREATED",
          "تم الإنشاء",
          "نشر البائع العرض. لا شيء محجوز ولا عدّاد صفقة يعمل بعد؛ يبقى العرض معروضاً 7 أيام"
        ],
        [
          "ACCEPTED",
          "تم القبول",
          "قبِل مشترٍ العرض. أمام البائع الآن ساعة واحدة للتمويل"
        ],
        [
          "FUNDED",
          "تم التمويل",
          "500 KDA مقفلة في عقد الضمان"
        ],
        [
          "PAID",
          "تم الدفع",
          "أرسل المشتري 4.80$ عبر Wise وأشّر على الدفع مع لقطة شاشة كإثبات"
        ],
        [
          "COMPLETED",
          "مكتملة",
          "أكد البائع وصول المبلغ وحرّر عملات KDA"
        ]
      ]
    },
    "facts": {
      "contract": "عقد الضمان",
      "chain": "السلسلة 1، شبكة Kadena الرئيسية",
      "view": "اطّلع على كود العقد",
      "review": "مهل الضمان",
      "reviewSub": "التمويل · تأشير الدفع · التحرير",
      "bounty": "المتداولون الجدد",
      "bountyValue": "500 KDA",
      "bountySub": "لكل صفقة، حتى إكمال 3 صفقات",
      "fee": "رسوم المنصة",
      "feeValue": "لا توجد",
      "feeSub": "فقط رسوم الشبكة، أقل من 0.0001 KDA لكل معاملة"
    },
    "how": {
      "h2": "كيف تتم الصفقة",
      "p": "خمس خطوات، كل منها مسجلة على Chainweb. تتحرك عملات KDA مرتين فقط: إلى الضمان عندما يموّل البائع الصفقة، وإلى المشتري عندما يحرّرها البائع.",
      "steps": [
        [
          "ينشر البائع عرضاً",
          "الكمية، والسعر لكل KDA، وطرق الدفع التي يقبلها، وأين يريد استلام المبلغ."
        ],
        [
          "يقبل مشترٍ العرض",
          "يمكن لأي شخص محادثة البائع حول العرض قبل قبوله. والقبول موافقة واحدة في Linx."
        ],
        [
          "يموّل البائع الضمان",
          "تصبح عملات KDA مقفلة في العقد. لا يستطيع أي طرف تحريكها بمفرده. ويصل المشتري بريد وإشعار."
        ],
        [
          "يدفع المشتري ويؤشّر على الدفع",
          "المبلغ الدقيق، إلى بيانات الدفع الظاهرة في الصفقة، عبر USDT أو USDC أو Wise أو Revolut أو BRO. ثم يرفع لقطة شاشة للتحويل كإثبات."
        ],
        [
          "يحرّر البائع عملات KDA",
          "بعد أن يتأكد البائع من وصول المبلغ فعلاً إلى حسابه، يحرّر العملات ويرسلها العقد إلى المشتري."
        ]
      ],
      "deadlineH": "إذا انتهت المهلة",
      "deadlineP": "بعد القبول، يستطيع البائع إغلاق الصفقة غير الممولة إذا مرت ساعة. وبعد التمويل، يستطيع استرداد العملات إذا لم يؤشّر المشتري على الدفع خلال 4 ساعات. وإذا لم يحرّر البائع العملات خلال ساعة من تأشير الدفع، يمكن نقل الصفقة إلى نزاع لمراجعة المحكّم. تتطلب هذه الإجراءات إرسال معاملة على السلسلة.",
      "wrongH": "إذا حدث خطأ",
      "wrongP": "يستطيع أي طرف فتح نزاع من داخل الصفقة. يراجع المحكّم المذكور في العقد الأدلة التي يرفعها الطرفان ويسجّل قراراً على السلسلة بإرسال عملات KDA إلى المشتري أو إعادتها إلى البائع.",
      "personH": "إذا احتجت إلى شخص",
      "personPre": "فريق Kadena Nexus موجود في ",
      "personLink": "مجموعة تيليجرام",
      "personPost": ". اسأل هناك قبل الصفقة أو أثناءها أو بعدها، وسنساعدك خطوة بخطوة.",
      "watchCaption": "صفقة كاملة بين هاتفين من داخل محفظة Linx، من نشر العرض حتى وصول KDA. عرض توضيحي بحسابات تجريبية (الشرح في الفيديو بالإنجليزية)."
    },
    "compare": {
      "h2": "ضمان على Kadena أم منصة P2P مركزية",
      "p": "كلاهما يتيح لك الشراء من شخص آخر. الفرق هو من يحتفظ بالعملات بينما تنتظر الدفع.",
      "ours": "Kadena P2P Marketplace",
      "theirs": "منصة P2P مركزية",
      "rows": [
        [
          "من يحتفظ بـ KDA أثناء الصفقة",
          "عقد Pact على السلسلة 1",
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
      "note": "تتم المدفوعات عبر USDT أو USDC أو Wise أو Revolut أو BRO بينك وبين المتداول الآخر، خارج العقد. تأكد من وصول المبلغ قبل التحرير، والتزم بالأنظمة المعمول بها في بلدك."
    },
    "need": {
      "h2": "ما تحتاجه قبل البدء",
      "p": "أربعة أشياء. لا حساب ولا تحقق من الهوية.",
      "items": [
        [
          "محفظة Linx على جوالك",
          "السوق موجود داخل محفظة Linx: في Linx افتح Explore ← Web3 Apps ← Kadena ← Kadena P2P Marketplace، ووافق على كل خطوة دون مغادرة التطبيق. ويمكنك أيضاً فتح marketplace.kadena.ws في متصفح جوالك وربط Linx. المحفظة هي حسابك، وكل خطوة في الصفقة موافقة واحدة."
        ],
        [
          "قليل من KDA على السلسلة 1 لرسوم الشبكة",
          "كل معاملة تكلف أقل من 0.0001 KDA، لذا 0.1 KDA تكفي لعشرات الصفقات. يحتاج البائعون أيضاً إلى عملات KDA التي يريدون بيعها على السلسلة 1. قد تعرض محفظتك مجموع رصيدك على كل السلاسل؛ هنا يُحتسب فقط رصيدك على السلسلة 1."
        ],
        [
          "طريقة دفع يقبلها الطرف الآخر",
          "USDT أو USDC أو Wise أو Revolut أو BRO، حسب ما يدرجه العرض. لا نستخدم التحويلات البنكية. يتم الدفع بينكما خارج العقد."
        ],
        [
          "بريد إلكتروني لإشعارات الصفقات",
          "تؤكده مرة واحدة برابط. تصلك كل خطوة من صفقاتك بالبريد (متى تموّل أو تدفع أو تحرّر، وقبل انتهاء المهلة)، كما في منصات التداول. لا يراه غيرك وغير السوق."
        ]
      ]
    },
    "faq": {
      "h2": "أسئلة يطرحها الناس قبل صفقتهم الأولى",
      "items": [
        [
          "أين تكون عملات KDA الخاصة بي أثناء الصفقة؟",
          "في عقد الضمان free.p2p-escrow-v10 على السلسلة 1، ليس في محفظة أي شخص ولا لدى Kadena Nexus. لا يحرّكها العقد إلا إلى المشتري عندما يحرّرها البائع، أو إلى البائع عند الاسترداد، أو حسب قرار المحكّم في حالة النزاع."
        ],
        [
          "من هو المحكّم وكيف يقرر؟",
          "حساب محكّم يديره فريق Kadena Nexus يُكتب في كل ضمان عند إنشائه، ويمكنك رؤية عنوانه في كل صفقة. لا يستطيع المحكّم التصرف إلا في الصفقات المتنازع عليها أو التي انتهت مهلتها، ويراجع الأدلة التي يرفعها الطرفان، ويُسجَّل القرار على السلسلة."
        ],
        [
          "كم التكلفة؟",
          "لا شيء من السوق. كل خطوة على السلسلة هي معاملة Kadena عادية، برسوم أقل من 0.0001 KDA."
        ],
        [
          "على أي سلسلة يجب أن تكون عملات KDA؟",
          "السلسلة 1. إذا كانت عملاتك على سلسلة أخرى، انقلها أولاً عبر التحويل بين السلاسل في محفظتك."
        ],
        [
          "ماذا لو اختفى الطرف الآخر؟",
          "لا يمكن أخذ شيء منك. إذا لم يموّل المشتري أو لم يدفع، تنتهي المهلة ويغلق البائع الصفقة أو يسترد عملاته. وإذا لم يحرّر البائع بعد أن دفعت، افتح نزاعاً مع إثبات الدفع ويفصل فيه المحكّم."
        ],
        [
          "هل يمكنني الإلغاء؟",
          "قبل أن يقبل أحد، احذف عرضك في أي وقت؛ فهو لا يحجز شيئاً. بعد القبول، يتبع الإلغاء قواعد الصفقة: البائع الذي لم يموّل بعد يمكنه الإلغاء، وبعد التمويل لا تخرج عملات KDA من الضمان إلا بالتحرير أو الاسترداد أو قرار المحكّم."
        ],
        [
          "لماذا يوجد حد 500 KDA؟",
          "لتبقى الصفقات الأولى صغيرة. إلى أن تكمل المحفظة 3 صفقات، يكون كل عرض تنشئه أو تقبله بحد أقصى 500 KDA. بعد ذلك لا يوجد حد، ولا تظهر عبارة \"متداول جديد\" على عروضها."
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
          "نشر العرض مجاني ولا يحجز شيئاً.",
          "لا تتحرك أي عملات KDA أو أموال عند إنشاء العروض أو تصفحها. لا يأخذ الضمان عملات البائع إلا بعد قبول الصفقة واختيار البائع تمويلها."
        ],
        [
          "يبقى العرض المفتوح معروضاً 7 أيام.",
          "إذا لم يقبله أحد خلالها، يُرفع من السوق ويصلك إشعار: أعد عرضه بلمسة واحدة أو احذفه. تبدأ مهل الصفقة فقط عندما يقبل أحدهم: ساعة واحدة للتمويل، و4 ساعات لتأشير الدفع، وساعة واحدة للتحرير. عند انتهاء المهلة، يسمح العقد بالإغلاق أو الاسترداد أو نقل الصفقة إلى نزاع، بحسب مرحلتها. وتتطلب هذه الإجراءات إرسال معاملة على السلسلة."
        ],
        [
          "اسأل في المحادثة، لكن ادفع فقط إلى بيانات الصفقة.",
          "يمكنك مراسلة صاحب أي عرض قبل قبوله. مكان الدفع يحدده البائع ويظهر داخل الصفقة؛ لا تدفع أبداً إلى بيانات أخرى تُرسل في المحادثة."
        ],
        [
          "تصرّف عندما يأتي دورك.",
          "سيصلك بريد وإشعار. موّل، أو أشّر على الدفع، أو حرّر دون تأخير."
        ],
        [
          "الصفقات المكتملة لا يمكن عكسها.",
          "تأكد من وصول الدفعة إلى حسابك قبل التحرير؛ فلقطة الشاشة يمكن تزويرها. إذا بدا أي شيء خاطئاً، افتح نزاعاً بدلاً من التحرير."
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
  const [i, setI] = useState(2);
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
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">500 KDA</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.price}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">
            $0.0096 <span className="font-sans text-sm font-normal text-muted-foreground">{t.perKda}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.buyerPays}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">$4.80</dd>
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
          <OpenInLinxCard lang={lang} className="mt-6 max-w-[36rem]" />
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
            <dd dir="ltr" className="mt-1 font-mono text-[0.95rem]">free.p2p-escrow-v10</dd>
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
            <dd dir="ltr" className="mt-1 font-display text-2xl font-bold tabular-nums">1 h / 4 h / 1 h</dd>
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
