(() => {
'use strict';

/*
 * Web3Market Internal i18n
 * - No external translation service.
 * - Safe fallback to English when a phrase is not in the local dictionary.
 * - Deal Room message translation is NOT handled here; js/deal-translation.js remains separate.
 */

const LANGS = {
  en:'English', ar:'العربية', fr:'Français', es:'Español', tr:'Türkçe',
  de:'Deutsch', pt:'Português', ru:'Русский', zh:'中文', ja:'日本語', ko:'한국어'
};
const STORAGE_KEY='wm-language';
const BASE_TEXT=new WeakMap();
let observerStarted=false;

const T = {
  en:{
    'Marketplace':'Marketplace','Seller Dashboard':'Seller Dashboard','Buyer Dashboard':'Buyer Dashboard',
    'AI Project Passport':'AI Project Passport','Sign in':'Sign in','Sign Up':'Sign Up','Sign up':'Sign up',
    'Login':'Login','Logout':'Logout','Register':'Register','Create Account':'Create Account',
    'Sell a Project':'Sell a Project','Browse Projects':'Browse Projects','Support':'Support',
    'Language':'Language','Back to Marketplace':'Back to Marketplace','Search':'Search',
    'Load Passport':'Load Passport','Search Any Website / Web3 Project':'Search Any Website / Web3 Project',
    'Deal Room':'Deal Room','Deal Details':'Deal Details','Deal Chat':'Deal Chat','Send':'Send',
    'Write a message…':'Write a message…','Payment':'Payment','Delivery':'Delivery',
    'Signatures':'Signatures','Execution':'Execution','Completed':'Completed',
    'Loading':'Loading','Loading…':'Loading…','Save':'Save','Cancel':'Cancel','Submit':'Submit',
    'Next':'Next','Previous':'Previous','Continue':'Continue','Close':'Close','View':'View',
    'Learn More':'Learn More','Get Started':'Get Started','Connect Wallet':'Connect Wallet',
    'Connect & Verify Wallet':'Connect & Verify Wallet','Free Listing':'Free Listing',
    'AI Due Diligence':'AI Due Diligence','AI Valuation':'AI Valuation',
    'Web3Market':'Web3Market','The Marketplace for Web3':'The Marketplace for Web3',
    'Preferred Language':'Preferred Language','Language saved.':'Language saved.',
    'Could not save. Please try again.':'Could not save. Please try again.'
  },
  ar:{
    'Marketplace':'السوق','Seller Dashboard':'لوحة تحكم البائع','Buyer Dashboard':'لوحة تحكم المشتري',
    'AI Project Passport':'جواز مشروع AI','Sign in':'تسجيل الدخول','Sign Up':'إنشاء حساب','Sign up':'إنشاء حساب',
    'Login':'دخول','Logout':'تسجيل الخروج','Register':'تسجيل','Create Account':'إنشاء حساب',
    'Sell a Project':'بيع مشروع','Browse Projects':'تصفح المشاريع','Support':'الدعم',
    'Language':'اللغة','Back to Marketplace':'العودة إلى السوق','Search':'بحث',
    'Load Passport':'تحميل الجواز','Search Any Website / Web3 Project':'البحث عن أي موقع / مشروع Web3',
    'Deal Room':'غرفة الصفقة','Deal Details':'تفاصيل الصفقة','Deal Chat':'محادثة الصفقة','Send':'إرسال',
    'Write a message…':'اكتب رسالة…','Payment':'الدفع','Delivery':'التسليم',
    'Signatures':'التوقيعات','Execution':'التنفيذ','Completed':'مكتملة',
    'Loading':'جارٍ التحميل','Loading…':'جارٍ التحميل…','Save':'حفظ','Cancel':'إلغاء','Submit':'إرسال',
    'Next':'التالي','Previous':'السابق','Continue':'متابعة','Close':'إغلاق','View':'عرض',
    'Learn More':'اعرف المزيد','Get Started':'ابدأ الآن','Connect Wallet':'ربط المحفظة',
    'Connect & Verify Wallet':'ربط المحفظة والتحقق منها','Free Listing':'إدراج مجاني',
    'AI Due Diligence':'العناية الواجبة بالذكاء الاصطناعي','AI Valuation':'التقييم بالذكاء الاصطناعي',
    'Web3Market':'Web3Market','The Marketplace for Web3':'سوق Web3',
    'Preferred Language':'اللغة المفضلة','Language saved.':'تم حفظ اللغة.',
    'Could not save. Please try again.':'تعذر حفظ اللغة. حاول مرة أخرى.'
,
    "Web3Market — AI-Powered On-Chain Web3 Project Marketplace":"Web3Market — سوق مشاريع Web3 بالذكاء الاصطناعي وعلى السلسلة",
    "— the marketplace for Web3 commerce":"— سوق تجارة Web3",
    "BNB Chain ready • Global • Secure by design":"جاهز لـ BNB Chain • عالمي • مصمم للأمان",
    "Categories":"الفئات",
    "Sell":"بيع",
    "How it works":"كيف يعمل",
    "📱 Download APK":"📱 تحميل APK",
    "Choose account type":"اختر نوع الحساب",
    "AI + ON-CHAIN WEB3 MARKETPLACE":"سوق Web3 بالذكاء الاصطناعي وعلى السلسلة",
    "The World's First Marketplace for Buying & Selling Web3 Projects":"أول سوق لشراء وبيع مشاريع Web3",
    "Powered by AI. Built On-Chain.":"مدعوم بالذكاء الاصطناعي. مبني على السلسلة.",
    "LIST YOUR WEB3 PROJECT FOR FREE":"أدرج مشروع Web3 الخاص بك مجانًا",
    "Pay only when your deal successfully closes.":"ادفع فقط عند إتمام صفقتك بنجاح.",
    "No upfront listing fees • No monthly fees •":"لا توجد رسوم إدراج مقدمة • لا توجد رسوم شهرية •",
    "7.5% success fee":"رسوم نجاح 7.5%",
    "when your deal closes.":"عند إتمام الصفقة.",
    "Explore marketplace":"استكشف السوق",
    "Choose Buyer or Seller":"اختر مشتريًا أو بائعًا",
    "Contact Support":"تواصل مع الدعم",
    "AI-powered project review":"مراجعة المشروع بالذكاء الاصطناعي",
    "On-chain transaction ready":"جاهز للمعاملة على السلسلة",
    "Global Web3 marketplace":"سوق Web3 عالمي",
    "Browse Web3 opportunities":"تصفح فرص Web3",
    "Real projects, structured information and a clear acquisition path.":"مشاريع حقيقية، معلومات منظمة ومسار واضح للاستحواذ.",
    "View marketplace →":"عرض السوق →",
    "All Projects":"جميع المشاريع",
    "Micro-SaaS":"Micro-SaaS",
    "Loading active Web3 projects…":"جارٍ تحميل مشاريع Web3 النشطة…",
    "AI Review":"مراجعة بالذكاء الاصطناعي",
    "Structured project evaluation":"تقييم منظم للمشروع",
    "On-Chain Ready":"جاهز على السلسلة",
    "Built toward secure transactions":"مصمم للمعاملات الآمنة",
    "Buyer + Seller":"مشتري + بائع",
    "One marketplace for both sides":"سوق واحد للطرفين",
    "Global":"عالمي",
    "Web3 projects and buyers worldwide":"مشاريع Web3 ومشترون من جميع أنحاء العالم",
    "One marketplace. Two paths.":"سوق واحد. مساران.",
    "Buy a Web3 project or list one for acquisition with a structured workflow.":"اشترِ مشروع Web3 أو أدرجه للاستحواذ من خلال سير عمل منظم.",
    "FOR BUYERS":"للمشترين",
    "Find your next Web3 opportunity.":"اعثر على فرصتك التالية في Web3.",
    "Browse projects, compare opportunities and evaluate available information before moving forward.":"تصفح المشاريع وقارن الفرص وقيّم المعلومات المتاحة قبل المتابعة.",
    "Browse project categories":"تصفح فئات المشاريع",
    "Review seller-provided data":"راجع بيانات البائع",
    "Use AI-powered project review":"استخدم مراجعة المشروع بالذكاء الاصطناعي",
    "Move toward a protected transaction":"انتقل نحو معاملة محمية",
    "Explore Projects":"استكشف المشاريع",
    "Create Buyer Account":"إنشاء حساب مشتري",
    "FOR SELLERS":"للبائعين",
    "Turn your Web3 project into an acquisition opportunity.":"حوّل مشروع Web3 الخاص بك إلى فرصة للاستحواذ.",
    "List your project for free, present the important details and connect with serious buyers.":"أدرج مشروعك مجانًا، واعرض التفاصيل المهمة وتواصل مع مشترين جادين.",
    "Free project listing":"إدراج المشروع مجانًا",
    "AI-assisted review":"مراجعة بمساعدة الذكاء الاصطناعي",
    "Structured buyer presentation":"عرض منظم للمشتري",
    "7.5% success fee only when the deal closes":"رسوم نجاح 7.5% فقط عند إتمام الصفقة",
    "List Your Project":"أدرج مشروعك",
    "Create Seller Account":"إنشاء حساب بائع",
    "How Web3Market works":"كيف تعمل Web3Market",
    "A simple path from discovery to a protected on-chain transaction.":"مسار بسيط من اكتشاف المشروع إلى معاملة محمية على السلسلة.",
    "Discover":"اكتشف",
    "Browse Web3 projects and use marketplace filters to find opportunities.":"تصفح مشاريع Web3 واستخدم فلاتر السوق للعثور على الفرص.",
    "Evaluate with AI":"قيّم بالذكاء الاصطناعي",
    "Review available project data and AI-powered scoring before making a decision.":"راجع بيانات المشروع المتاحة وتقييم الذكاء الاصطناعي قبل اتخاذ القرار.",
    "Buy & transfer on-chain":"الشراء والنقل على السلسلة",
    "Ready to enter the Web3 project market?":"هل أنت مستعد لدخول سوق مشاريع Web3؟",
    "Discover projects, evaluate opportunities with AI and build toward secure on-chain transactions.":"اكتشف المشاريع وقيّم الفرص بالذكاء الاصطناعي واستعد لمعاملات آمنة على السلسلة.",
    "Explore Marketplace":"استكشف السوق",
    "Create Account":"إنشاء حساب",
    "Discover Web3 Projects Ready for Acquisition.":"اكتشف مشاريع Web3 الجاهزة للاستحواذ.",
    "Browse active projects":"تصفح المشاريع النشطة",
    "List your project":"أدرج مشروعك",
    "Listed":"مدرج",
    "Under AI Review":"قيد مراجعة الذكاء الاصطناعي",
    "Pending Execution":"بانتظار التنفيذ",
    "Sold":"مباع",
    "All categories":"جميع الفئات",
    "Active listings":"الإدراجات النشطة",
    "Welcome back":"مرحبًا بعودتك",
    "Sign in with your Web3Market email and password, or continue with GitHub.":"سجّل الدخول باستخدام بريد Web3Market وكلمة المرور، أو تابع باستخدام GitHub.",
    "Continue with GitHub":"المتابعة باستخدام GitHub",
    "Continue with Google":"المتابعة باستخدام Google",
    "Email address":"عنوان البريد الإلكتروني",
    "Password":"كلمة المرور",
    "Forgot your password?":"هل نسيت كلمة المرور؟",
    "Resend confirmation email":"إعادة إرسال رسالة التأكيد",
    "Create a new account":"إنشاء حساب جديد",
    "Create your account":"أنشئ حسابك",
    "Choose Buyer or Seller, enter your details, then create your account.":"اختر مشتريًا أو بائعًا، وأدخل بياناتك، ثم أنشئ حسابك.",
    "Buyer account":"حساب مشتري",
    "Seller account":"حساب بائع",
    "Select an account type to continue.":"اختر نوع الحساب للمتابعة.",
    "Full name":"الاسم الكامل",
    "Confirm password":"تأكيد كلمة المرور",
    "I'm not a robot":"أنا لست روبوتًا",
    "Create account":"إنشاء الحساب",
    "Already have an account? Sign in":"لديك حساب بالفعل؟ سجّل الدخول",
    "Buyer Center":"مركز المشتري",
    "Profile":"الملف الشخصي",
    "Home":"الرئيسية",
    "Seller Center":"مركز البائع",
    "Overview":"نظرة عامة",
    "My Listings":"إدراجاتي",
    "Orders & Deals":"الطلبات والصفقات",
    "Messages":"الرسائل",
    "Reviews":"المراجعات",
    "Earnings":"الأرباح",
    "Wallet":"المحفظة",
    "Settings":"الإعدادات",
    "New Listing":"إدراج جديد",
    "Listing Guide":"دليل الإدراج",
    "Seller wallet":"محفظة البائع",
    "How to List a Project":"كيفية إدراج مشروع",
    "Open Full Guide →":"فتح الدليل الكامل →",
    "Your saved draft can be continued from Sell a Project.":"يمكنك متابعة المسودة المحفوظة من صفحة بيع مشروع.",
    "Prepare Your Project":"جهّز مشروعك",
    "Project details, website, GitHub, technology, audience, assets and ownership evidence.":"تفاصيل المشروع والموقع وGitHub والتقنية والجمهور والأصول وأدلة الملكية.",
    "Build Your Listing":"أنشئ إدراجك",
    "Complete business model, financials, traction, price, transfer terms and buyer presentation.":"أكمل نموذج العمل والبيانات المالية والجذب والسعر وشروط النقل وعرض المشتري.",
    "Verification → AI Review":"التحقق ← مراجعة الذكاء الاصطناعي",
    "Save your draft, resolve missing evidence, submit for AI Review, then wait for Admin approval.":"احفظ المسودة واستكمل الأدلة الناقصة وأرسلها للمراجعة بالذكاء الاصطناعي ثم انتظر موافقة المسؤول.",
    "Loading seller dashboard…":"جارٍ تحميل لوحة البائع…",
    "Back to Marketplace":"العودة إلى السوق",
    "Choose a Web3Market project or search any public Web3 project.":"اختر مشروعًا من Web3Market أو ابحث عن أي مشروع Web3 عام.",
    "How can we help?":"كيف يمكننا مساعدتك؟",
    "Email support@web3market.xyz":"البريد الإلكتروني support@web3market.xyz",
    "Support email:":"بريد الدعم:",
    "Messages are routed securely through our mail forwarding service to the support inbox.":"تُوجّه الرسائل بأمان عبر خدمة إعادة توجيه البريد إلى صندوق دعم Web3Market."  },
    "Web3Market Marketplace":"سوق Web3Market","Marketplace | Web3Market":"السوق | Web3Market","WEB3MARKET MARKETPLACE":"سوق WEB3MARKET","AI":"الذكاء الاصطناعي","DeFi":"التمويل اللامركزي","Gaming":"الألعاب","Infrastructure":"البنية التحتية","Tools":"الأدوات","Search":"بحث","Loading Buyer Center…":"جارٍ تحميل مركز المشتري…","Loading buyer account…":"جارٍ تحميل حساب المشتري…","Buyer account verified":"تم التحقق من حساب المشتري","Manage purchases, payment verification and every deal in one place.":"أدر مشترياتك والتحقق من المدفوعات وجميع الصفقات من مكان واحد.","TOTAL SPENT":"إجمالي الإنفاق","PURCHASES":"المشتريات","ACTIVE DEALS":"الصفقات النشطة","Completed purchases":"المشتريات المكتملة","Successfully completed":"مكتملة بنجاح","Currently in progress":"قيد التنفيذ حاليًا","Active Deals":"الصفقات النشطة","Track purchases and payment verification":"تتبع المشتريات والتحقق من المدفوعات","Purchase History":"سجل المشتريات","Your completed transactions":"معاملاتك المكتملة","BUYER IDENTITY":"هوية المشتري","VERIFIED BUYER":"مشتري موثّق","Edit profile →":"تعديل الملف الشخصي →","WALLET":"المحفظة","Not connected":"غير متصلة","Connect a wallet when ready to transact.":"اربط محفظتك عندما تكون مستعدًا لإجراء المعاملة.","Manage Wallet":"إدارة المحفظة","TRANSACTION PROTECTION":"حماية المعاملة","On-chain payment verification":"التحقق من الدفع على السلسلة","Payments are verified against the locked deal, buyer wallet, Safe and token.":"يتم التحقق من المدفوعات مقابل الصفقة المقفلة ومحفظة المشتري وSafe والرمز.","Transparent platform fee":"رسوم منصة شفافة","The fee is locked when the deal is created.":"يتم تثبيت الرسوم عند إنشاء الصفقة.","No active purchases":"لا توجد مشتريات نشطة","Your accepted deals will appear here.":"ستظهر صفقاتك المقبولة هنا.","Browse Marketplace":"تصفح السوق","No completed purchases yet":"لا توجد مشتريات مكتملة حتى الآن","Manage listings and verified deals.":"أدر الإدراجات والصفقات الموثقة.","View Marketplace":"عرض السوق","＋ Add Listing":"＋ إضافة إدراج","Seller workflow: listing → deal → verified payment → delivery.":"سير عمل البائع: إدراج → صفقة → دفع موثّق → تسليم.","Seller Profile":"ملف البائع","Wallet & Payouts":"المحفظة والمدفوعات","Connected & verified ✓":"متصلة وموثقة ✓","Wallet ownership not verified":"ملكية المحفظة غير موثقة","Connect another wallet":"ربط محفظة أخرى","Connect Web3 Wallet":"ربط محفظة Web3","Choose your wallet. Ownership is verified with a free signature only.":"اختر محفظتك. يتم التحقق من الملكية بتوقيع مجاني فقط.","Earnings & Platform Fee":"الأرباح ورسوم المنصة","Gross":"الإجمالي","Platform fee":"رسوم المنصة","Edit Listing":"تعديل الإدراج","Untitled project":"مشروع بدون عنوان","No listings yet.":"لا توجد إدراجات بعد.","No deals yet.":"لا توجد صفقات بعد.","Payment verified":"تم التحقق من الدفع","Payment pending":"الدفع قيد الانتظار","Fee":"الرسوم","Wallet verification uses a free signature only. No transaction or transfer of funds is requested.":"يستخدم التحقق من المحفظة توقيعًا مجانيًا فقط. لا يُطلب أي تحويل أو معاملة مالية.","Deals could not be loaded":"تعذر تحميل الصفقات","Purchase history could not be loaded":"تعذر تحميل سجل المشتريات","Unable to connect to the database. Please reload the page.":"تعذر الاتصال بقاعدة البيانات. يرجى إعادة تحميل الصفحة.","No active session was found. Please sign in again.":"لم يتم العثور على جلسة دخول فعالة. يرجى تسجيل الدخول مرة أخرى.","Unable to load your Buyer profile.":"تعذر تحميل ملف المشتري الخاص بك.","This account is not a Buyer account.":"هذا الحساب ليس حساب مشتري.","Buyer profile is unavailable, but the dashboard remains active.":"ملف المشتري غير متاح، لكن لوحة التحكم ما زالت تعمل.","Your account and profile are still available.":"لا يزال حسابك وملفك الشخصي متاحين.","Purchase history could not be loaded":"تعذر تحميل سجل المشتريات","Seller Dashboard":"لوحة تحكم البائع","My Listings":"إدراجاتي","Orders & Deals":"الطلبات والصفقات","Loading…":"جارٍ التحميل…","Loading seller dashboard…":"جارٍ تحميل لوحة البائع…",
  fr:{
    'Marketplace':'Marketplace','Seller Dashboard':'Tableau de bord vendeur','Buyer Dashboard':'Tableau de bord acheteur',
    'AI Project Passport':'Passeport de projet IA','Sign in':'Se connecter','Sign Up':'Créer un compte','Sign up':'Créer un compte',
    'Login':'Connexion','Logout':'Déconnexion','Register':'Inscription','Create Account':'Créer un compte',
    'Sell a Project':'Vendre un projet','Browse Projects':'Parcourir les projets','Support':'Assistance',
    'Language':'Langue','Back to Marketplace':'Retour au Marketplace','Search':'Rechercher',
    'Load Passport':'Charger le passeport','Search Any Website / Web3 Project':'Rechercher un site / projet Web3',
    'Deal Room':'Espace de transaction','Deal Details':'Détails de la transaction','Deal Chat':'Discussion de la transaction','Send':'Envoyer',
    'Write a message…':'Écrire un message…','Payment':'Paiement','Delivery':'Livraison','Signatures':'Signatures',
    'Execution':'Exécution','Completed':'Terminé','Loading':'Chargement','Loading…':'Chargement…',
    'Save':'Enregistrer','Cancel':'Annuler','Submit':'Envoyer','Next':'Suivant','Previous':'Précédent',
    'Continue':'Continuer','Close':'Fermer','View':'Voir','Learn More':'En savoir plus','Get Started':'Commencer',
    'Connect Wallet':'Connecter le portefeuille','Connect & Verify Wallet':'Connecter et vérifier le portefeuille',
    'Free Listing':'Annonce gratuite','AI Due Diligence':'Due diligence IA','AI Valuation':'Évaluation IA',
    'Web3Market':'Web3Market','The Marketplace for Web3':'La marketplace Web3',
    'Preferred Language':'Langue préférée','Language saved.':'Langue enregistrée.',
    'Could not save. Please try again.':'Impossible d’enregistrer. Réessayez.'
  },
  es:{
    'Marketplace':'Marketplace','Seller Dashboard':'Panel del vendedor','Buyer Dashboard':'Panel del comprador',
    'AI Project Passport':'Pasaporte de proyecto IA','Sign in':'Iniciar sesión','Sign Up':'Crear cuenta','Sign up':'Crear cuenta',
    'Login':'Iniciar sesión','Logout':'Cerrar sesión','Register':'Registrarse','Create Account':'Crear cuenta',
    'Sell a Project':'Vender un proyecto','Browse Projects':'Explorar proyectos','Support':'Soporte',
    'Language':'Idioma','Back to Marketplace':'Volver al Marketplace','Search':'Buscar',
    'Load Passport':'Cargar pasaporte','Search Any Website / Web3 Project':'Buscar cualquier sitio / proyecto Web3',
    'Deal Room':'Sala de negociación','Deal Details':'Detalles de la negociación','Deal Chat':'Chat de la negociación','Send':'Enviar',
    'Write a message…':'Escribe un mensaje…','Payment':'Pago','Delivery':'Entrega','Signatures':'Firmas',
    'Execution':'Ejecución','Completed':'Completado','Loading':'Cargando','Loading…':'Cargando…',
    'Save':'Guardar','Cancel':'Cancelar','Submit':'Enviar','Next':'Siguiente','Previous':'Anterior',
    'Continue':'Continuar','Close':'Cerrar','View':'Ver','Learn More':'Más información','Get Started':'Comenzar',
    'Connect Wallet':'Conectar cartera','Connect & Verify Wallet':'Conectar y verificar cartera',
    'Free Listing':'Publicación gratuita','AI Due Diligence':'Due diligence con IA','AI Valuation':'Valoración con IA',
    'Web3Market':'Web3Market','The Marketplace for Web3':'El marketplace de Web3',
    'Preferred Language':'Idioma preferido','Language saved.':'Idioma guardado.',
    'Could not save. Please try again.':'No se pudo guardar. Inténtalo de nuevo.'
  },
  tr:{
    'Marketplace':'Pazar','Seller Dashboard':'Satıcı Paneli','Buyer Dashboard':'Alıcı Paneli',
    'AI Project Passport':'AI Proje Pasaportu','Sign in':'Giriş yap','Sign Up':'Kayıt ol','Sign up':'Kayıt ol',
    'Login':'Giriş','Logout':'Çıkış','Register':'Kayıt','Create Account':'Hesap Oluştur',
    'Sell a Project':'Proje Sat','Browse Projects':'Projeleri Görüntüle','Support':'Destek',
    'Language':'Dil','Back to Marketplace':'Pazara Dön','Search':'Ara',
    'Load Passport':'Pasaportu Yükle','Search Any Website / Web3 Project':'Herhangi bir web sitesi / Web3 projesi ara',
    'Deal Room':'Anlaşma Odası','Deal Details':'Anlaşma Detayları','Deal Chat':'Anlaşma Sohbeti','Send':'Gönder',
    'Write a message…':'Mesaj yaz…','Payment':'Ödeme','Delivery':'Teslimat','Signatures':'İmzalar',
    'Execution':'Yürütme','Completed':'Tamamlandı','Loading':'Yükleniyor','Loading…':'Yükleniyor…',
    'Save':'Kaydet','Cancel':'İptal','Submit':'Gönder','Next':'İleri','Previous':'Önceki',
    'Continue':'Devam','Close':'Kapat','View':'Görüntüle','Learn More':'Daha Fazla Bilgi','Get Started':'Başla',
    'Connect Wallet':'Cüzdanı Bağla','Connect & Verify Wallet':'Cüzdanı Bağla ve Doğrula',
    'Free Listing':'Ücretsiz İlan','AI Due Diligence':'AI Durum Tespiti','AI Valuation':'AI Değerleme',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Web3 Marketplace',
    'Preferred Language':'Tercih Edilen Dil','Language saved.':'Dil kaydedildi.',
    'Could not save. Please try again.':'Kaydedilemedi. Lütfen tekrar deneyin.'
  },
  de:{
    'Marketplace':'Marktplatz','Seller Dashboard':'Verkäufer-Dashboard','Buyer Dashboard':'Käufer-Dashboard',
    'AI Project Passport':'KI-Projektpass','Sign in':'Anmelden','Sign Up':'Konto erstellen','Sign up':'Konto erstellen',
    'Login':'Anmeldung','Logout':'Abmelden','Register':'Registrieren','Create Account':'Konto erstellen',
    'Sell a Project':'Projekt verkaufen','Browse Projects':'Projekte durchsuchen','Support':'Support',
    'Language':'Sprache','Back to Marketplace':'Zurück zum Marktplatz','Search':'Suchen',
    'Load Passport':'Pass laden','Search Any Website / Web3 Project':'Website / Web3-Projekt suchen',
    'Deal Room':'Transaktionsraum','Deal Details':'Transaktionsdetails','Deal Chat':'Transaktionschat','Send':'Senden',
    'Write a message…':'Nachricht schreiben…','Payment':'Zahlung','Delivery':'Übergabe','Signatures':'Signaturen',
    'Execution':'Ausführung','Completed':'Abgeschlossen','Loading':'Wird geladen','Loading…':'Wird geladen…',
    'Save':'Speichern','Cancel':'Abbrechen','Submit':'Senden','Next':'Weiter','Previous':'Zurück',
    'Continue':'Fortfahren','Close':'Schließen','View':'Ansehen','Learn More':'Mehr erfahren','Get Started':'Loslegen',
    'Connect Wallet':'Wallet verbinden','Connect & Verify Wallet':'Wallet verbinden und verifizieren',
    'Free Listing':'Kostenloses Listing','AI Due Diligence':'KI-Due-Diligence','AI Valuation':'KI-Bewertung',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Der Web3-Marktplatz',
    'Preferred Language':'Bevorzugte Sprache','Language saved.':'Sprache gespeichert.',
    'Could not save. Please try again.':'Speichern fehlgeschlagen. Bitte erneut versuchen.'
  },
  pt:{
    'Marketplace':'Marketplace','Seller Dashboard':'Painel do vendedor','Buyer Dashboard':'Painel do comprador',
    'AI Project Passport':'Passaporte de Projeto IA','Sign in':'Entrar','Sign Up':'Criar conta','Sign up':'Criar conta',
    'Login':'Entrar','Logout':'Sair','Register':'Registrar','Create Account':'Criar conta',
    'Sell a Project':'Vender um projeto','Browse Projects':'Explorar projetos','Support':'Suporte',
    'Language':'Idioma','Back to Marketplace':'Voltar ao Marketplace','Search':'Pesquisar',
    'Load Passport':'Carregar passaporte','Search Any Website / Web3 Project':'Pesquisar qualquer site / projeto Web3',
    'Deal Room':'Sala de negociação','Deal Details':'Detalhes da negociação','Deal Chat':'Chat da negociação','Send':'Enviar',
    'Write a message…':'Escreva uma mensagem…','Payment':'Pagamento','Delivery':'Entrega','Signatures':'Assinaturas',
    'Execution':'Execução','Completed':'Concluído','Loading':'Carregando','Loading…':'Carregando…',
    'Save':'Salvar','Cancel':'Cancelar','Submit':'Enviar','Next':'Próximo','Previous':'Anterior',
    'Continue':'Continuar','Close':'Fechar','View':'Ver','Learn More':'Saiba mais','Get Started':'Começar',
    'Connect Wallet':'Conectar carteira','Connect & Verify Wallet':'Conectar e verificar carteira',
    'Free Listing':'Anúncio grátis','AI Due Diligence':'Due diligence com IA','AI Valuation':'Avaliação com IA',
    'Web3Market':'Web3Market','The Marketplace for Web3':'O marketplace Web3',
    'Preferred Language':'Idioma preferido','Language saved.':'Idioma salvo.',
    'Could not save. Please try again.':'Não foi possível salvar. Tente novamente.'
  },
  ru:{
    'Marketplace':'Маркетплейс','Seller Dashboard':'Панель продавца','Buyer Dashboard':'Панель покупателя',
    'AI Project Passport':'AI-паспорт проекта','Sign in':'Войти','Sign Up':'Создать аккаунт','Sign up':'Создать аккаунт',
    'Login':'Вход','Logout':'Выйти','Register':'Регистрация','Create Account':'Создать аккаунт',
    'Sell a Project':'Продать проект','Browse Projects':'Просмотреть проекты','Support':'Поддержка',
    'Language':'Язык','Back to Marketplace':'Назад в маркетплейс','Search':'Поиск',
    'Load Passport':'Загрузить паспорт','Search Any Website / Web3 Project':'Найти сайт / Web3-проект',
    'Deal Room':'Комната сделки','Deal Details':'Детали сделки','Deal Chat':'Чат сделки','Send':'Отправить',
    'Write a message…':'Напишите сообщение…','Payment':'Оплата','Delivery':'Передача','Signatures':'Подписи',
    'Execution':'Исполнение','Completed':'Завершено','Loading':'Загрузка','Loading…':'Загрузка…',
    'Save':'Сохранить','Cancel':'Отмена','Submit':'Отправить','Next':'Далее','Previous':'Назад',
    'Continue':'Продолжить','Close':'Закрыть','View':'Просмотр','Learn More':'Подробнее','Get Started':'Начать',
    'Connect Wallet':'Подключить кошелёк','Connect & Verify Wallet':'Подключить и проверить кошелёк',
    'Free Listing':'Бесплатное размещение','AI Due Diligence':'AI-дью-дилидженс','AI Valuation':'AI-оценка',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Маркетплейс Web3',
    'Preferred Language':'Предпочтительный язык','Language saved.':'Язык сохранён.',
    'Could not save. Please try again.':'Не удалось сохранить. Повторите попытку.'
  },
  zh:{
    'Marketplace':'市场','Seller Dashboard':'卖家控制台','Buyer Dashboard':'买家控制台',
    'AI Project Passport':'AI 项目护照','Sign in':'登录','Sign Up':'注册','Sign up':'注册',
    'Login':'登录','Logout':'退出登录','Register':'注册','Create Account':'创建账户',
    'Sell a Project':'出售项目','Browse Projects':'浏览项目','Support':'支持',
    'Language':'语言','Back to Marketplace':'返回市场','Search':'搜索',
    'Load Passport':'加载护照','Search Any Website / Web3 Project':'搜索网站 / Web3 项目',
    'Deal Room':'交易室','Deal Details':'交易详情','Deal Chat':'交易聊天','Send':'发送',
    'Write a message…':'输入消息…','Payment':'付款','Delivery':'交付','Signatures':'签名',
    'Execution':'执行','Completed':'已完成','Loading':'加载中','Loading…':'加载中…',
    'Save':'保存','Cancel':'取消','Submit':'提交','Next':'下一步','Previous':'上一步',
    'Continue':'继续','Close':'关闭','View':'查看','Learn More':'了解更多','Get Started':'开始',
    'Connect Wallet':'连接钱包','Connect & Verify Wallet':'连接并验证钱包',
    'Free Listing':'免费上架','AI Due Diligence':'AI 尽职调查','AI Valuation':'AI 估值',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Web3 市场',
    'Preferred Language':'首选语言','Language saved.':'语言已保存。',
    'Could not save. Please try again.':'无法保存，请重试。'
  },
  ja:{
    'Marketplace':'マーケットプレイス','Seller Dashboard':'販売者ダッシュボード','Buyer Dashboard':'購入者ダッシュボード',
    'AI Project Passport':'AIプロジェクトパスポート','Sign in':'ログイン','Sign Up':'アカウント作成','Sign up':'アカウント作成',
    'Login':'ログイン','Logout':'ログアウト','Register':'登録','Create Account':'アカウント作成',
    'Sell a Project':'プロジェクトを売る','Browse Projects':'プロジェクトを見る','Support':'サポート',
    'Language':'言語','Back to Marketplace':'マーケットプレイスに戻る','Search':'検索',
    'Load Passport':'パスポートを読み込む','Search Any Website / Web3 Project':'Webサイト / Web3プロジェクトを検索',
    'Deal Room':'取引ルーム','Deal Details':'取引詳細','Deal Chat':'取引チャット','Send':'送信',
    'Write a message…':'メッセージを入力…','Payment':'支払い','Delivery':'引き渡し','Signatures':'署名',
    'Execution':'実行','Completed':'完了','Loading':'読み込み中','Loading…':'読み込み中…',
    'Save':'保存','Cancel':'キャンセル','Submit':'送信','Next':'次へ','Previous':'前へ',
    'Continue':'続行','Close':'閉じる','View':'表示','Learn More':'詳しく見る','Get Started':'始める',
    'Connect Wallet':'ウォレットを接続','Connect & Verify Wallet':'ウォレットを接続して確認',
    'Free Listing':'無料掲載','AI Due Diligence':'AIデューデリジェンス','AI Valuation':'AI評価',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Web3マーケットプレイス',
    'Preferred Language':'優先言語','Language saved.':'言語を保存しました。',
    'Could not save. Please try again.':'保存できませんでした。もう一度お試しください。'
  },
  ko:{
    'Marketplace':'마켓플레이스','Seller Dashboard':'판매자 대시보드','Buyer Dashboard':'구매자 대시보드',
    'AI Project Passport':'AI 프로젝트 패스포트','Sign in':'로그인','Sign Up':'회원가입','Sign up':'회원가입',
    'Login':'로그인','Logout':'로그아웃','Register':'등록','Create Account':'계정 만들기',
    'Sell a Project':'프로젝트 판매','Browse Projects':'프로젝트 둘러보기','Support':'지원',
    'Language':'언어','Back to Marketplace':'마켓플레이스로 돌아가기','Search':'검색',
    'Load Passport':'패스포트 불러오기','Search Any Website / Web3 Project':'웹사이트 / Web3 프로젝트 검색',
    'Deal Room':'거래실','Deal Details':'거래 세부정보','Deal Chat':'거래 채팅','Send':'보내기',
    'Write a message…':'메시지를 입력하세요…','Payment':'결제','Delivery':'전달','Signatures':'서명',
    'Execution':'실행','Completed':'완료','Loading':'로드 중','Loading…':'로드 중…',
    'Save':'저장','Cancel':'취소','Submit':'제출','Next':'다음','Previous':'이전',
    'Continue':'계속','Close':'닫기','View':'보기','Learn More':'자세히 보기','Get Started':'시작하기',
    'Connect Wallet':'지갑 연결','Connect & Verify Wallet':'지갑 연결 및 확인',
    'Free Listing':'무료 등록','AI Due Diligence':'AI 실사','AI Valuation':'AI 평가',
    'Web3Market':'Web3Market','The Marketplace for Web3':'Web3 마켓플레이스',
    'Preferred Language':'선호 언어','Language saved.':'언어가 저장되었습니다.',
    'Could not save. Please try again.':'저장하지 못했습니다. 다시 시도해 주세요.'
  }
};

function getSavedLanguage(){
  try { const v=localStorage.getItem(STORAGE_KEY); return LANGS[v]?v:'en'; }
  catch(e){ return 'en'; }
}
function saveLanguage(lang){
  const safe=LANGS[lang]?lang:'en';
  try{localStorage.setItem(STORAGE_KEY,safe);}catch(e){}
  applyDirection(safe);
}
function applyDirection(lang){
  const safe=LANGS[lang]?lang:'en';
  document.documentElement.lang=safe;
  document.documentElement.dir=safe==='ar'?'rtl':'ltr';
  document.documentElement.setAttribute('data-wm-language',safe);
  if(document.body)document.body.setAttribute('data-wm-language',safe);
}
function translate(value,lang){
  if(!value)return value;
  const safe=LANGS[lang]?lang:'en';
  return T[safe]?.[value] ?? value;
}
function translateNodeText(root,lang){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      const p=node.parentElement;
      if(!p || ['SCRIPT','STYLE','NOSCRIPT','TEXTAREA'].includes(p.tagName))return NodeFilter.FILTER_REJECT;
      if(p.closest('[data-i18n-ignore]'))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    if(!BASE_TEXT.has(node))BASE_TEXT.set(node,node.nodeValue);
    const base=BASE_TEXT.get(node)||'';
    const trimmed=base.trim();
    if(!trimmed)return;
    const translated=translate(trimmed,lang);
    node.nodeValue=base.replace(trimmed,translated);
  });
}
function translateAttributes(root,lang){
  const nodes=[]; if(root.matches?.('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]'))nodes.push(root); root.querySelectorAll?.('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]').forEach(el=>nodes.push(el)); nodes.forEach(el=>{
    const key=el.getAttribute('data-i18n');
    if(key && T[lang]?.[key])el.textContent=T[lang][key];
    const ph=el.getAttribute('data-i18n-placeholder');
    if(ph)el.setAttribute('placeholder',translate(ph,lang));
    const title=el.getAttribute('data-i18n-title');
    if(title)el.setAttribute('title',translate(title,lang));
    const aria=el.getAttribute('data-i18n-aria-label');
    if(aria)el.setAttribute('aria-label',translate(aria,lang));
  });
}
function applyLanguage(lang){
  const safe=LANGS[lang]?lang:'en';
  if(location.pathname.split('/').pop().toLowerCase()==='deal-room.html')return;
  applyDirection(safe);
  translateNodeText(document.body,safe);
  translateAttributes(document,safe);
  window.dispatchEvent(new CustomEvent('web3market:languagechange',{detail:{language:safe}}));
}
function setLanguage(lang){
  const safe=LANGS[lang]?lang:'en';
  saveLanguage(safe);
  applyLanguage(safe);
}
function addPicker(){
  if(document.getElementById('wm-language'))return;
  const nav=document.querySelector('.navin')||document.querySelector('.topbar')||document.querySelector('header')||document.body;
  if(!nav)return;
  const wrap=document.createElement('div');
  wrap.id='wm-language';
  wrap.style.cssText='position:relative;display:inline-flex;align-items:center;margin-left:8px;z-index:10000';
  const b=document.createElement('button');
  b.type='button';b.setAttribute('aria-label','Language');b.title='Language';b.textContent='🌐';
  b.style.cssText='height:40px;min-width:40px;border:1px solid #dce1e8;border-radius:50%;background:#fff;cursor:pointer;font-size:19px';
  const m=document.createElement('div');
  m.style.cssText='display:none;position:absolute;right:0;top:46px;background:#fff;border:1px solid #e1e5eb;border-radius:12px;box-shadow:0 14px 35px rgba(20,24,32,.15);padding:6px;z-index:99999;min-width:160px;max-height:70vh;overflow:auto';
  Object.entries(LANGS).forEach(([code,name])=>{
    const x=document.createElement('button');
    x.type='button';x.textContent=name;
    x.style.cssText='display:block;width:100%;padding:9px 10px;border:0;background:#fff;text-align:left;border-radius:8px;cursor:pointer';
    x.addEventListener('click',()=>{m.style.display='none';setLanguage(code);});
    m.appendChild(x);
  });
  b.addEventListener('click',e=>{e.stopPropagation();m.style.display=m.style.display==='block'?'none':'block';});
  document.addEventListener('click',()=>{m.style.display='none';});
  wrap.append(b,m);nav.appendChild(wrap);
}
function startObserver(){
  if(observerStarted||!window.MutationObserver)return;
  observerStarted=true;
  const root=document.body;
  if(!root)return;
  const observer=new MutationObserver(mutations=>{
    const lang=getSavedLanguage();
    mutations.forEach(m=>m.addedNodes.forEach(node=>{
      if(node.nodeType===1){
        translateNodeText(node,lang);
        translateAttributes(node,lang);
      }
    }));
  });
  observer.observe(root,{childList:true,subtree:true});
}
function init(){
  const saved=getSavedLanguage();
  if(location.pathname.split('/').pop().toLowerCase()==='deal-room.html')return;
  applyDirection(saved);
  addPicker();
  applyLanguage(saved);
  startObserver();
}
window.Web3MarketI18n={langs:LANGS,setLanguage,translate,applyLanguage,getLanguage:getSavedLanguage};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();