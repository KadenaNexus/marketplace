import type { Lang } from "@/components/NexusLanding";

export type AlertsCopy = {
  cta: string; ctaShort: string; signUp: string; strip: string;
  title: string; intro: string;
  email: string; emailPh: string;
  what: string; sell: string; sellSub: string; buy: string; buySub: string;
  currency: string; anyCurrency: string;
  amount: string; min: string; max: string; amountHint: string;
  when: string; instant: string; instantSub: string; daily: string; dailySub: string;
  submit: string; sending: string; save: string; saving: string; saved: string;
  checkTitle: string; checkBody: string; checkSpam: string; close: string;
  privacy: string;
  errPick: string; errEmail: string; errMinMax: string; errGeneric: string; errOff: string;
  // /alerts page
  pageTitle: string; confirming: string; confirmedTitle: string; confirmedBody: string;
  manageTitle: string; manageFor: string; unsubscribe: string; unsubscribing: string;
  unsubscribedTitle: string; unsubscribedBody: string; resubscribe: string;
  badLink: string; backToMarket: string;
  // deep link from an alert email
  offerNotice: string; offerGone: string;
};

export const ALERTS_COPY: Record<Lang, AlertsCopy> = {
  en: {
    cta: "Get offer alerts by email",
    ctaShort: "Offer alerts",
    signUp: "Sign up",
    strip: "Get an email when a new offer is posted, so you don't miss one.",
    title: "Offer alerts",
    intro: "We email you when a new offer is posted. No wallet needed to sign up.",
    email: "Email", emailPh: "you@example.com",
    what: "Which offers?",
    sell: "Offers to sell KDA", sellSub: "for when you want to buy",
    buy: "Offers to buy KDA", buySub: "for when you want to sell",
    currency: "Price currency", anyCurrency: "Any",
    amount: "Amount (KDA, optional)", min: "Min", max: "Max", amountHint: "Leave empty for any amount.",
    when: "How often?",
    instant: "Instant", instantSub: "one email per new offer",
    daily: "Daily summary", dailySub: "one email at 9:00 Riyadh time",
    submit: "Get alerts", sending: "Signing up…", save: "Save changes", saving: "Saving…", saved: "Saved.",
    checkTitle: "Check your inbox",
    checkBody: "We sent a confirmation link. Alerts start once you click it.",
    checkSpam: "Not there in a few minutes? Check spam, or the Promotions tab in Gmail.",
    close: "Close",
    privacy: "We only use your email for these alerts. Every email has a one-click unsubscribe.",
    errPick: "Pick at least one kind of offer.",
    errEmail: "Enter a valid email address.",
    errMinMax: "The minimum is above the maximum.",
    errGeneric: "Something went wrong. Please try again.",
    errOff: "Offer alerts are not switched on yet. Please try again later.",
    pageTitle: "Offer alerts",
    confirming: "Confirming…",
    confirmedTitle: "You're signed up",
    confirmedBody: "We'll email you when a matching offer is posted. You can change your choices below.",
    manageTitle: "Your offer alerts",
    manageFor: "Alerts for",
    unsubscribe: "Unsubscribe", unsubscribing: "Unsubscribing…",
    unsubscribedTitle: "You're unsubscribed",
    unsubscribedBody: "You won't get offer alerts any more.",
    resubscribe: "Turn alerts back on",
    badLink: "This link is not valid or has expired. Sign up again from the Marketplace.",
    backToMarket: "Go to the Marketplace",
    offerNotice: "Connect your Ecko wallet to see the offer from your alert.",
    offerGone: "That offer has already been taken or closed. Here are the open offers.",
  },
  ar: {
    cta: "استلم تنبيهات العروض بالبريد",
    ctaShort: "تنبيهات العروض",
    signUp: "اشترك",
    strip: "استلم رسالة عند نشر عرض جديد حتى لا يفوتك.",
    title: "تنبيهات العروض",
    intro: "نرسل لك رسالة عند نشر عرض جديد. لا تحتاج محفظة للاشتراك.",
    email: "البريد الإلكتروني", emailPh: "you@example.com",
    what: "أي العروض؟",
    sell: "عروض بيع KDA", sellSub: "إذا كنت تريد الشراء",
    buy: "عروض شراء KDA", buySub: "إذا كنت تريد البيع",
    currency: "عملة السعر", anyCurrency: "أي عملة",
    amount: "الكمية (KDA، اختياري)", min: "الأدنى", max: "الأعلى", amountHint: "اتركها فارغة لأي كمية.",
    when: "كم مرة؟",
    instant: "فوري", instantSub: "رسالة لكل عرض جديد",
    daily: "ملخص يومي", dailySub: "رسالة واحدة الساعة 9:00 بتوقيت الرياض",
    submit: "اشترك في التنبيهات", sending: "جارٍ الاشتراك…", save: "حفظ التغييرات", saving: "جارٍ الحفظ…", saved: "تم الحفظ.",
    checkTitle: "تحقق من بريدك",
    checkBody: "أرسلنا رابط تأكيد. تبدأ التنبيهات بعد الضغط عليه.",
    checkSpam: "لم تصلك خلال دقائق؟ تحقق من مجلد الرسائل غير المرغوب فيها أو تبويب العروض الترويجية في Gmail.",
    close: "إغلاق",
    privacy: "نستخدم بريدك لهذه التنبيهات فقط، وفي كل رسالة رابط لإلغاء الاشتراك بضغطة واحدة.",
    errPick: "اختر نوعًا واحدًا من العروض على الأقل.",
    errEmail: "أدخل بريدًا إلكترونيًا صحيحًا.",
    errMinMax: "الحد الأدنى أكبر من الحد الأعلى.",
    errGeneric: "حدث خطأ. حاول مرة أخرى.",
    errOff: "تنبيهات العروض غير مفعلة بعد. حاول لاحقًا.",
    pageTitle: "تنبيهات العروض",
    confirming: "جارٍ التأكيد…",
    confirmedTitle: "تم اشتراكك",
    confirmedBody: "سنرسل لك رسالة عند نشر عرض مطابق. يمكنك تعديل اختياراتك أدناه.",
    manageTitle: "تنبيهات العروض الخاصة بك",
    manageFor: "التنبيهات للبريد",
    unsubscribe: "إلغاء الاشتراك", unsubscribing: "جارٍ الإلغاء…",
    unsubscribedTitle: "تم إلغاء اشتراكك",
    unsubscribedBody: "لن تصلك تنبيهات العروض بعد الآن.",
    resubscribe: "إعادة تفعيل التنبيهات",
    badLink: "هذا الرابط غير صالح أو منتهي. اشترك مرة أخرى من السوق.",
    backToMarket: "الذهاب إلى السوق",
    offerNotice: "اربط محفظة Ecko لرؤية العرض الذي وصلك في التنبيه.",
    offerGone: "هذا العرض أُخذ أو أُغلق بالفعل. هذه هي العروض المفتوحة.",
  },
};
