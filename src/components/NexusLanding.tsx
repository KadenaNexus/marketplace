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
//     practiceVideoUrl="https://www.youtube.com/embed/XXXX"  // optional, see README
//     contractUrl="https://github.com/.../p2p-escrow-v10.pact" // optional, see README
//   />
//
// The header and footer stay in their own components (see 4-copy-changes.md). The language
// pill rendered at the top of the hero can be moved into the header if you prefer; it only
// needs `lang` and `setLang` (export `useLang` below).

import { ReactNode, useEffect, useState } from "react";

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
  };
  compare: { h2: string; p: string; ours: string; theirs: string; rows: Triple[]; note: string };
  need: { h2: string; p: string; items: Pair[] };
  practice: { h2: string; p: string; steps: Pair[]; videoCaption: string; videoPlaceholder: string };
  faq: { h2: string; items: Pair[] };
  rules: { h2: string; items: Pair[] };
  start: { lead: string; getEcko: string; connect: string; questionsPre: string; tg: string; questionsPost: string };
};

const COPY: Record<Lang, Copy> = {
  "en": {
    "langName": "English",
    "switchTo": "العربية",
    "switchAria": "Switch to Arabic",
    "hero": {
      "h1": "Trade KDA person to person, with the coins held in escrow",
      "p": "Agree a price with another trader and pay the way you both choose. The seller's KDA stays locked in a Pact contract on Chain 1 until they confirm your payment, and an arbiter settles it if something goes wrong.",
      "try": "Try it with 1 KDA first",
      "note": "No sign-up and no platform fee. You pay only Kadena network gas."
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
      "payWithValue": "Wise, bank transfer",
      "left": "left",
      "done": "done",
      "steps": [
        [
          "CREATED",
          "Created",
          "Seller posted the offer. Nothing is held and no clock is running yet; it stays listed until the seller removes it"
        ],
        [
          "ACCEPTED",
          "Accepted",
          "A buyer took it and opened the chat"
        ],
        [
          "FUNDED",
          "Funded",
          "2,500 KDA locked in the escrow contract"
        ],
        [
          "PAID",
          "Paid",
          "Buyer sent $24.00 by Wise and marked it paid"
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
      "bounty": "Contract behavior",
      "bountyValue": "On-chain",
      "bountySub": "timeouts follow Pact rules",
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
          "Amount, price per KDA, and the payment methods they accept."
        ],
        [
          "A buyer accepts it",
          "Both sides agree the details in the trade chat."
        ],
        [
          "The seller funds the escrow",
          "Their KDA is now locked in the contract. Neither side can move it alone."
        ],
        [
          "The buyer pays and marks it paid",
          "Off-chain, by Wise, bank transfer or another method the seller listed."
        ],
        [
          "The seller releases the KDA",
          "Once the money has arrived, the contract sends the KDA to the buyer."
        ]
      ],
      "deadlineH": "If a deadline passes",
      "deadlineP": "After acceptance, the seller can close an unfunded trade if 1 hour passes. After funding, the seller can refund if the buyer does not mark payment within 4 hours. If the seller does not release within 1 hour after payment is marked, the trade can move to a dispute for arbiter review. These timeout actions require an on-chain transaction.",
      "wrongH": "If something goes wrong",
      "wrongP": "When a trade is disputed, the arbiter named in the contract reviews the evidence and records a decision on-chain, sending escrow to the buyer or back to the seller.",
      "personH": "If you need a person",
      "personPre": "The Kadena Nexus team is in the ",
      "personLink": "Telegram group",
      "personPost": ". Ask there before, during, or after a trade, and we'll help you through it."
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
          "A Kadena wallet",
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
      "note": "Payments by bank, Wise and similar methods happen between you and the other trader, outside the contract. Check the money has arrived before you release, and follow the rules that apply where you live."
    },
    "need": {
      "h2": "What you need before you start",
      "p": "Three things. No account and no identity check.",
      "items": [
        [
          "A Kadena wallet",
          "Ecko Wallet, Chainweaver, or any wallet that supports WalletConnect. Your wallet is your account; there is no separate sign-up."
        ],
        [
          "A little KDA on Chain 1 for gas",
          "Each transaction costs under 0.0001 KDA, so 0.1 KDA covers dozens of trades. Sellers also need the KDA they want to sell on Chain 1. Your wallet may show your total across all chains; only the KDA on Chain 1 counts here."
        ],
        [
          "A payment method the other side accepts",
          "Wise, bank transfer, or whatever the offer lists. The payment happens between the two of you, outside the contract."
        ]
      ]
    },
    "practice": {
      "h2": "Not sure yet? Do a practice trade with yourself",
      "p": "You don't have to trust a stranger to learn how the escrow works. Use two of your own wallets, a small amount such as 1 KDA, and walk through every step. The only cost is Kadena network gas.",
      "steps": [
        [
          "Connect wallet A and post a sell offer",
          "1 KDA, any price, any payment method. It's only you on both sides."
        ],
        [
          "Open a private window, connect wallet B, accept the offer",
          "Now you're the buyer. Open the trade chat and see what the other side sees."
        ],
        [
          "Fund from A, mark paid from B, release from A",
          "Watch the 1 KDA go into the contract and come out to wallet B. Every step shows up on Chainweb."
        ],
        [
          "Then trade for real, still starting small",
          "Pick a seller with completed trades and a good rating, and keep the first few trades modest while you get comfortable."
        ]
      ],
      "videoCaption": "30 seconds: a 1 KDA practice trade from start to finish",
      "videoPlaceholder": "Your screen recording goes here"
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
          "An open offer stays listed until you remove it.",
          "Nothing expires while an offer is waiting for a buyer. The time limits only start once someone accepts: 1 hour to fund, 4 hours to mark the payment, 1 hour to release. If a deadline passes, the contract allows a close, refund or dispute transition depending on the trade stage. These timeout actions require an on-chain transaction."
        ],
        [
          "Agree the details in the trade chat first.",
          "Once an offer is accepted, a private chat opens between you and the other party. Settle the payment method, account name and timing there before anyone funds or pays."
        ],
        [
          "Act when it's your turn.",
          "Fund, mark as paid, or release without delay."
        ],
        [
          "Finished transactions can't be reversed.",
          "Check the payment has arrived before you release. If anything looks wrong, open a dispute instead of releasing."
        ]
      ]
    },
    "start": {
      "lead": "Connect your wallet to see open offers and post your own.",
      "getEcko": "Get Ecko Wallet",
      "connect": "Connect wallet",
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
      "p": "اتفق على السعر مع متداول آخر وادفع بالطريقة التي تختارانها. تبقى عملات KDA الخاصة بالبائع مقفلة في عقد Pact على السلسلة 1 حتى يؤكد استلام دفعتك، ويتدخل المحكّم لتسوية الأمر إذا حدث خطأ.",
      "try": "جرّبه أولاً بـ 1 KDA",
      "note": "لا تسجيل ولا رسوم منصة. تدفع فقط رسوم شبكة Kadena."
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
      "payWithValue": "Wise أو تحويل بنكي",
      "left": "متبقٍ",
      "done": "تم",
      "steps": [
        [
          "CREATED",
          "تم الإنشاء",
          "نشر البائع العرض. لا شيء محجوز ولا عدّاد يعمل بعد؛ يبقى العرض معروضاً حتى يحذفه البائع"
        ],
        [
          "ACCEPTED",
          "تم القبول",
          "قبِل مشترٍ العرض وفُتحت المحادثة"
        ],
        [
          "FUNDED",
          "تم التمويل",
          "2,500 KDA مقفلة في عقد الضمان"
        ],
        [
          "PAID",
          "تم الدفع",
          "أرسل المشتري 24.00$ عبر Wise وأشّر على الدفع"
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
      "bounty": "قواعد العقد",
      "bountyValue": "على السلسلة",
      "bountySub": "تتبع المهل قواعد Pact",
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
          "الكمية، والسعر لكل KDA، وطرق الدفع التي يقبلها."
        ],
        [
          "يقبل مشترٍ العرض",
          "يتفق الطرفان على التفاصيل في محادثة الصفقة."
        ],
        [
          "يموّل البائع الضمان",
          "تصبح عملات KDA مقفلة في العقد. لا يستطيع أي طرف تحريكها بمفرده."
        ],
        [
          "يدفع المشتري ويؤشّر على الدفع",
          "خارج السلسلة، عبر Wise أو تحويل بنكي أو أي طريقة أدرجها البائع."
        ],
        [
          "يحرّر البائع عملات KDA",
          "بعد وصول المبلغ، يرسل العقد عملات KDA إلى المشتري."
        ]
      ],
      "deadlineH": "إذا انتهت المهلة",
      "deadlineP": "بعد القبول، يستطيع البائع إغلاق الصفقة غير الممولة إذا مرت ساعة. وبعد التمويل، يستطيع استرداد العملات إذا لم يؤشّر المشتري على الدفع خلال 4 ساعات. وإذا لم يحرّر البائع العملات خلال ساعة من تأشير الدفع، يمكن نقل الصفقة إلى نزاع لمراجعة المحكّم. تتطلب هذه الإجراءات إرسال معاملة على السلسلة.",
      "wrongH": "إذا حدث خطأ",
      "wrongP": "عندما تصبح الصفقة محل نزاع، يراجع المحكّم المذكور في العقد الأدلة ويسجّل قراراً على السلسلة بإرسال عملات الضمان إلى المشتري أو إعادتها إلى البائع.",
      "personH": "إذا احتجت إلى شخص",
      "personPre": "فريق Kadena Nexus موجود في ",
      "personLink": "مجموعة تيليجرام",
      "personPost": ". اسأل هناك قبل الصفقة أو أثناءها أو بعدها، وسنساعدك خطوة بخطوة."
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
          "محفظة Kadena",
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
      "note": "تتم المدفوعات عبر البنك أو Wise أو الطرق المشابهة بينك وبين المتداول الآخر، خارج العقد. تأكد من وصول المبلغ قبل التحرير، والتزم بالأنظمة المعمول بها في بلدك."
    },
    "need": {
      "h2": "ما تحتاجه قبل البدء",
      "p": "ثلاثة أشياء فقط. لا حساب ولا تحقق من الهوية.",
      "items": [
        [
          "محفظة Kadena",
          "Ecko Wallet أو Chainweaver أو أي محفظة تدعم WalletConnect. المحفظة هي حسابك؛ لا يوجد تسجيل منفصل."
        ],
        [
          "قليل من KDA على السلسلة 1 لرسوم الشبكة",
          "كل معاملة تكلف أقل من 0.0001 KDA، لذا 0.1 KDA تكفي لعشرات الصفقات. يحتاج البائعون أيضاً إلى عملات KDA التي يريدون بيعها على السلسلة 1. قد تعرض محفظتك مجموع رصيدك على كل السلاسل؛ هنا يُحتسب فقط رصيدك على السلسلة 1."
        ],
        [
          "طريقة دفع يقبلها الطرف الآخر",
          "Wise، أو تحويل بنكي، أو أي طريقة مدرجة في العرض. يتم الدفع بينكما خارج العقد."
        ]
      ]
    },
    "practice": {
      "h2": "لست متأكداً بعد؟ جرّب صفقة مع نفسك",
      "p": "لا تحتاج إلى الثقة بشخص غريب لتتعلم كيف يعمل الضمان. استخدم محفظتين من محافظك، ومبلغاً صغيراً مثل 1 KDA، وامشِ عبر كل خطوة. التكلفة الوحيدة هي رسوم شبكة Kadena.",
      "steps": [
        [
          "اربط المحفظة A وانشر عرض بيع",
          "1 KDA، بأي سعر، وبأي طريقة دفع. أنت وحدك على الطرفين."
        ],
        [
          "افتح نافذة خاصة، اربط المحفظة B، واقبل العرض",
          "الآن أنت المشتري. افتح محادثة الصفقة وشاهد ما يراه الطرف الآخر."
        ],
        [
          "موّل من A، أشّر على الدفع من B، وحرّر من A",
          "شاهد 1 KDA تدخل العقد وتخرج إلى المحفظة B. كل خطوة تظهر على Chainweb."
        ],
        [
          "ثم تداول فعلياً، مع البدء بمبالغ صغيرة",
          "اختر بائعاً لديه صفقات مكتملة وتقييم جيد، وأبقِ صفقاتك الأولى متواضعة حتى تشعر بالراحة."
        ]
      ],
      "videoCaption": "30 ثانية: صفقة تدريبية بـ 1 KDA من البداية إلى النهاية",
      "videoPlaceholder": "تسجيل الشاشة يوضع هنا"
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
          "يبقى العرض المفتوح معروضاً حتى تحذفه.",
          "لا شيء ينتهي بينما ينتظر العرض مشترياً. تبدأ المهل الزمنية فقط عندما يقبل أحدهم: ساعة واحدة للتمويل، و4 ساعات لتأشير الدفع، وساعة واحدة للتحرير. عند انتهاء المهلة، يسمح العقد بالإغلاق أو الاسترداد أو نقل الصفقة إلى نزاع، بحسب مرحلتها. وتتطلب هذه الإجراءات إرسال معاملة على السلسلة."
        ],
        [
          "اتفقا على التفاصيل في محادثة الصفقة أولاً.",
          "بعد قبول العرض، تُفتح محادثة خاصة بينك وبين الطرف الآخر. حددا فيها طريقة الدفع واسم الحساب والتوقيت قبل أن يموّل أو يدفع أي طرف."
        ],
        [
          "تصرّف عندما يأتي دورك.",
          "موّل، أو أشّر على الدفع، أو حرّر دون تأخير."
        ],
        [
          "الصفقات المكتملة لا يمكن عكسها.",
          "تأكد من وصول الدفعة قبل التحرير. إذا بدا أي شيء خاطئاً، افتح نزاعاً بدلاً من التحرير."
        ]
      ]
    },
    "start": {
      "lead": "اربط محفظتك لترى العروض المفتوحة وتنشر عرضك.",
      "getEcko": "احصل على Ecko Wallet",
      "connect": "اربط المحفظة",
      "questionsPre": "لديك أسئلة أولاً؟ اسأل في ",
      "tg": "مجموعة Kadena Nexus على تيليجرام",
      "questionsPost": "."
    }
  }
};

const LANG_KEY = "nx-lang";

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
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
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
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">2,500 KDA</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.price}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">
            $0.0096 <span className="font-sans text-sm font-normal text-muted-foreground">{t.perKda}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.buyerPays}</dt>
          <dd dir="ltr" className="font-display text-lg font-semibold tabular-nums">$24.00</dd>
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
            <li key={chip} className="grid grid-cols-[1.25rem_1fr_auto] gap-x-3">
              <span className="flex flex-col items-center">
                <span className={"mt-1 h-3 w-3 rounded-full border-2 transition-colors " + dot} />
                {k < last && <span className={"mt-1 w-0.5 flex-1 transition-colors " + (k < i ? "bg-primary" : "bg-border")} />}
              </span>
              <span className={k < last ? "pb-4" : ""}>
                <b className="block font-semibold">{title}</b>
                <span className="text-sm text-muted-foreground">{note}</span>
              </span>
              <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                {isNow ? `${fmt(left)} ${t.left}` : k < i ? t.done : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type NexusLandingProps = {
  walletAction: ReactNode;
  /** Embed URL (YouTube/Vimeo) or a direct .mp4/.webm link to the 30-second practice-trade recording. */
  practiceVideoUrl?: string;
  /** Link to the contract source (GitHub file or explorer page). The "View the contract source" link hides when empty. */
  contractUrl?: string;
};

export default function NexusLanding({ walletAction, practiceVideoUrl, contractUrl }: NexusLandingProps) {
  const [lang, setLang] = useLang();
  const t = COPY[lang];
  const rtl = lang === "ar";
  const h2 = "font-display text-[clamp(1.8rem,3vw,2.5rem)] font-semibold leading-tight";
  const link = "font-semibold text-primary hover:underline";
  const isFile = !!practiceVideoUrl && /\.(mp4|webm|mov)(\?|$)/i.test(practiceVideoUrl);

  return (
    <div className="font-sans text-foreground" dir={rtl ? "rtl" : "ltr"} lang={lang}>
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
            <a href="#practice" className="inline-flex h-11 items-center rounded-full border border-border px-5 font-semibold text-foreground hover:border-primary">
              {t.hero.try}
            </a>
          </div>
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
          <div className="mt-10 overflow-x-auto">
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

      {/* Practice trade */}
      <section id="practice" className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[5fr_7fr] lg:gap-16 lg:py-20">
          <div className="min-w-0">
            <h2 className={h2}>{t.practice.h2}</h2>
            <p className="mt-4 max-w-[36rem] text-muted-foreground">{t.practice.p}</p>
            {practiceVideoUrl && (
              <figure className="mt-8">
                <div className="aspect-video overflow-hidden rounded-lg border border-border bg-card">
                  {isFile ? (
                    <video src={practiceVideoUrl} controls playsInline className="h-full w-full" />
                  ) : (
                    <iframe
                      src={practiceVideoUrl}
                      title={t.practice.videoCaption}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  )}
                </div>
                <figcaption className="mt-2 text-sm text-muted-foreground">{t.practice.videoCaption}</figcaption>
              </figure>
            )}
          </div>
          <ol className="grid gap-0 border-t border-border">
            {t.practice.steps.map(([title, d], k) => (
              <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-border py-4">
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
                href="https://www.ecko.finance/wallet"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center rounded-full border border-border px-5 font-semibold text-foreground hover:border-primary"
              >
                {t.start.getEcko}
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
