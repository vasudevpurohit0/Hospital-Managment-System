import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  KeyRound,
  ArrowRight,
  Check,
  Phone,
  Shield,
  Building2,
  Stethoscope,
  Users,
  ClipboardList,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { forgotPassword } from '../api/auth.api';
import { MpEmblem, AyushEmblem, TricolourRule } from '../components/branding/GovtEmblems';

/* ═══════════════════════════════════════════════════════════
   AAYUSH SAARTHI — Hospital Login
   Government of Madhya Pradesh · Department of AYUSH

   Implements the approved FINAL-UI reference. The authentication path is
   unchanged: one unified form for everyone, with the backend resolving
   hospital staff vs. platform Super Admin from the identifier alone.
   ═══════════════════════════════════════════════════════════ */

type Lang = 'en' | 'hi';

/**
 * The header offers English/हिन्दी, so the copy has to actually exist in both.
 * Scoped to this screen on purpose — the app carries no i18n framework, and
 * introducing one would reach well past a login redesign. A language control
 * that changed nothing would be worse than no control at all.
 */
const COPY = {
  en: {
    govLine1: 'GOVERNMENT OF',
    govLine2: 'MADHYA PRADESH',
    deptEn: 'Department of AYUSH',
    deptEnSub: 'Madhya Pradesh',
    helpline: 'Helpline',
    pillars: ['People', 'Prevention', 'Traditional Healing', 'Prosperous MP'],
    lead: 'Digital platform for stronger AYUSH services, better healthcare access and healthier communities.',
    watermark: ['SEVA', 'Swasthya', 'Samriddhi', 'Madhya Pradesh'],
    stats: [
      { value: '450+', label: 'Hospitals' },
      { value: '2,100+', label: 'Doctors' },
      { value: '7.5+ L', label: 'Patients' },
      { value: '50+', label: 'Schemes' },
    ],
    cardTitle: 'Hospital Login',
    cardSub: 'Login to access AAYUSH SAARTHI',
    idLabel: 'Government Email / User ID',
    idPlaceholder: 'doctor@mp.gov.in',
    pwLabel: 'Password',
    pwPlaceholder: 'Enter password',
    keepSession: 'Keep session active',
    forgot: 'Forgot Password?',
    submit: 'SECURE LOGIN',
    submitting: 'VERIFYING CREDENTIALS',
    or: 'OR',
    authTitle: 'Authorized Personnel Only',
    authBody: 'This system is for official use by authorized staff only.',
    authFailed: 'Authentication Failed',
    forgotNeedsId: 'Enter your Government Email / User ID above, then select Forgot Password.',
    showPw: 'Show password',
    hidePw: 'Hide password',
    copyright: '© Government of Madhya Pradesh  •  Department of AYUSH  |  All Rights Reserved',
    links: ['Privacy Policy', 'Terms of Use', 'Accessibility', 'Contact Us'],
  },
  hi: {
    govLine1: 'मध्य प्रदेश',
    govLine2: 'शासन',
    deptEn: 'आयुष विभाग',
    deptEnSub: 'मध्य प्रदेश',
    helpline: 'हेल्पलाइन',
    pillars: ['जन', 'रोकथाम', 'पारंपरिक चिकित्सा', 'समृद्ध मध्य प्रदेश'],
    lead: 'सुदृढ़ आयुष सेवाओं, बेहतर स्वास्थ्य सुविधाओं और स्वस्थ समुदायों के लिए डिजिटल मंच।',
    watermark: ['सेवा', 'स्वास्थ्य', 'समृद्धि', 'मध्य प्रदेश'],
    stats: [
      { value: '450+', label: 'अस्पताल' },
      { value: '2,100+', label: 'चिकित्सक' },
      { value: '7.5+ लाख', label: 'रोगी' },
      { value: '50+', label: 'योजनाएँ' },
    ],
    cardTitle: 'अस्पताल लॉगिन',
    cardSub: 'आयुष सारथी में प्रवेश करें',
    idLabel: 'शासकीय ईमेल / उपयोगकर्ता आईडी',
    idPlaceholder: 'doctor@mp.gov.in',
    pwLabel: 'पासवर्ड',
    pwPlaceholder: 'पासवर्ड दर्ज करें',
    keepSession: 'सत्र सक्रिय रखें',
    forgot: 'पासवर्ड भूल गए?',
    submit: 'सुरक्षित लॉगिन',
    submitting: 'प्रमाणीकरण जारी है',
    or: 'अथवा',
    authTitle: 'केवल अधिकृत कर्मियों हेतु',
    authBody: 'यह प्रणाली केवल अधिकृत शासकीय कर्मचारियों के आधिकारिक उपयोग हेतु है।',
    authFailed: 'प्रमाणीकरण विफल',
    forgotNeedsId:
      'पहले ऊपर अपना शासकीय ईमेल / उपयोगकर्ता आईडी दर्ज करें, फिर पासवर्ड भूल गए चुनें।',
    showPw: 'पासवर्ड दिखाएँ',
    hidePw: 'पासवर्ड छिपाएँ',
    copyright: '© मध्य प्रदेश शासन  •  आयुष विभाग  |  सर्वाधिकार सुरक्षित',
    links: ['गोपनीयता नीति', 'उपयोग की शर्तें', 'सुगम्यता', 'संपर्क करें'],
  },
} as const;

const HELPLINE = '1800-11-2526';
const STAT_ICONS = [Building2, Stethoscope, Users, ClipboardList];
/** Orange for reach, navy for the clinical figure, green for schemes — a fixed
    accent set from the brand palette, not a per-item rainbow. */
const STAT_TONES = ['text-[#F97D09]', 'text-[#062B4F]', 'text-[#F97D09]', 'text-[#1E8A4F]'];

/* ── Background: strong framing ribbons + faint MP wash as in FINAL-UI ── */
const BackgroundDecor: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1536 1024"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="saarthiRibbonWarm" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#FF8B1A" stopOpacity="0.98" />
          <stop offset="55%" stopColor="#F97D09" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#F97D09" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="saarthiRibbonSoft" x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0%" stopColor="#FFA94A" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#F97D09" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {/* Top-right diagonal — outer strong band */}
      <path d="M1095 -10 C1220 55 1340 95 1536 52 L1536 -12 Z" fill="#FF8B1A" opacity="0.98" />
      <path d="M1128 32 C1260 95 1385 135 1536 112 L1536 52 C1350 95 1220 55 1128 32 Z" fill="url(#saarthiRibbonSoft)" />
      <path d="M1175 78 C1295 135 1410 165 1536 148 L1536 112 C1385 135 1260 95 1175 78 Z" fill="#FFF1DD" opacity="0.45" />
      {/* Bottom-left diagonal — matches the orange sweep under the stats */}
      <path d="M-40 640 C 80 690 170 760 230 860 L -40 860 Z" fill="#FF8B1A" opacity="0.92" />
      <path d="M-40 700 C 70 740 140 790 200 860 L -40 860 Z" fill="url(#saarthiRibbonSoft)" />
      {/* Very soft large cream arcs echoing the background circle in FINAL-UI */}
      <ellipse cx="75" cy="540" rx="260" ry="340" fill="#FFF8ED" opacity="0.88" />
      <ellipse cx="1420" cy="210" rx="250" ry="210" fill="#FFF4E6" opacity="0.80" />
    </svg>
    {/* Faint MP wash behind SEVA text — soft peach shape, not a bitmap with baked text */}
    <div
      className="absolute left-[51%] top-[10%] hidden h-[390px] w-[360px] -translate-x-1/2 opacity-[0.10] lg:block"
      style={{
        background:
          'radial-gradient(ellipse 60% 52% at 48% 42%, #F9C88A 0%, #FBE2C0 42%, transparent 72%)',
        filter: 'blur(0.6px)',
      }}
    />
  </div>
);

/**
 * Heritage skyline along the foot of the page.
 *
 * The line art is lifted from the approved Final-UI 2 reference into
 * transparent PNGs (see scripts/extract-heritage.cjs): the main temple complex
 * sits bottom-left at the reference's own 57% width, with the fainter distant
 * cluster bottom-right, exactly as composed there. Both are decorative.
 *
 * The bottom offset clears the footer, which is taller once its rows stack on
 * narrow screens -- hence the breakpoint steps rather than a single value.
 */
const HeritageBand: React.FC = () => (
  <div
    className="pointer-events-none absolute inset-x-0 bottom-0 top-0 overflow-hidden"
    aria-hidden="true"
  >
    {/* Warm peach ground the temple line-art sits on, matching FINAL-UI */}
    <div className="absolute inset-x-0 bottom-0 h-[28vh] max-h-[320px] min-h-[150px] bg-gradient-to-t from-[#FCE8CC] via-[#FCEEDD]/70 to-transparent lg:h-[26vh]" />

    <img
      src="/mp-heritage.png"
      alt=""
      className="absolute bottom-[36px] left-0 w-[96%] max-w-[980px] select-none opacity-[0.88] sm:bottom-[40px] lg:bottom-[40px] lg:w-[61%] xl:w-[58%]"
      style={{
        WebkitMaskImage: 'linear-gradient(to right, #000 82%, transparent 100%)',
        maskImage: 'linear-gradient(to right, #000 82%, transparent 100%)',
      }}
      loading="eager"
      decoding="async"
    />

    <img
      src="/mp-heritage-right.png"
      alt=""
      className="absolute bottom-[36px] right-0 hidden w-[30%] max-w-[520px] select-none opacity-[0.76] sm:bottom-[40px] lg:bottom-[40px] xl:block"
      style={{
        WebkitMaskImage: 'linear-gradient(to left, #000 75%, transparent 100%)',
        maskImage: 'linear-gradient(to left, #000 75%, transparent 100%)',
      }}
      loading="lazy"
      decoding="async"
    />
  </div>
);

export const LoginPage: React.FC = () => {
  const { login, isLoading, error, clearError } = useAuth();

  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('saarthi-login-lang') === 'hi' ? 'hi' : 'en';
    } catch {
      return 'en';
    }
  });
  const t = COPY[lang];
  const hi = lang === 'hi' ? 'font-devanagari' : '';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSession, setKeepSession] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    identifierRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('saarthi-login-lang', lang);
    } catch {
      /* private browsing — the toggle still works for this visit */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 8000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) return;
    setNotice(null);
    await login(identifier.trim(), password.trim());
  };

  const handleForgot = useCallback(async () => {
    clearError();
    if (!identifier.trim()) {
      setNotice({ tone: 'warn', text: t.forgotNeedsId });
      identifierRef.current?.focus();
      return;
    }
    setResetPending(true);
    try {
      const res = await forgotPassword(identifier.trim());
      setNotice({ tone: 'info', text: res.message });
    } catch (err) {
      setNotice({ tone: 'warn', text: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setResetPending(false);
    }
  }, [identifier, clearError, t.forgotNeedsId]);

  const submitDisabled = isLoading || !identifier.trim() || !password.trim();

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-[#F8F7F3] font-sans text-[#062B4F] antialiased lg:h-screen lg:h-[100dvh] lg:overflow-hidden">
      <BackgroundDecor />
      <HeritageBand />

      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 sm:px-8 lg:min-h-0 lg:overflow-hidden lg:px-12">
        {/* ═══════════ Header — enlarged emblems, compact height ═══════════ */}
        <header className="flex shrink-0 flex-col gap-3 py-3 sm:py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-3.5">
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-5">
            <MpEmblem size={74} className="lg:!h-[80px] lg:!w-[80px]" />
            <div className="leading-tight">
              <p
                className={`text-[14px] font-extrabold uppercase text-[#062B4F] lg:text-[15.5px] ${hi}`}
              >
                {t.govLine1}
                <br />
                {t.govLine2}
              </p>
              {lang === 'en' && (
                <p className="mt-0.5 font-devanagari text-[11.5px] font-semibold text-[#062B4F]/70 lg:text-[12.5px]">
                  मध्य प्रदेश शासन
                </p>
              )}
            </div>

            <span
              className="mx-1 hidden h-11 w-px shrink-0 bg-[#062B4F]/15 sm:block lg:h-12"
              aria-hidden="true"
            />

            <div className="hidden items-center gap-3 sm:flex">
              <AyushEmblem size={70} className="lg:!h-[52px] lg:!w-[76px] [&>img]:!h-[76px] [&>img]:!w-[76px]" />
              <div className="leading-tight">
                {lang === 'en' && (
                  <>
                    <p className="font-devanagari text-[14px] font-bold text-[#062B4F]">
                      आयुष विभाग
                    </p>
                    <p className="font-devanagari text-[11px] text-[#062B4F]/60">मध्य प्रदेश</p>
                  </>
                )}
                <p className={`mt-0.5 text-[11.5px] font-semibold text-[#062B4F]/85 ${hi}`}>
                  {t.deptEn}
                </p>
                <p className={`text-[11px] text-[#062B4F]/60 ${hi}`}>{t.deptEnSub}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] sm:gap-x-4">
            <div className="flex items-center gap-2" role="group" aria-label="Language">
              {(['en', 'hi'] as const).map((code, i) => (
                <React.Fragment key={code}>
                  {i > 0 && (
                    <span className="text-[#062B4F]/25" aria-hidden="true">
                      |
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLang(code)}
                    aria-pressed={lang === code}
                    className={`rounded px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50 ${
                      lang === code
                        ? 'font-bold text-[#062B4F]'
                        : 'text-[#062B4F]/55 hover:text-[#062B4F]'
                    } ${code === 'hi' ? 'font-devanagari' : ''}`}
                  >
                    {code === 'en' ? 'English' : 'हिन्दी'}
                  </button>
                </React.Fragment>
              ))}
            </div>

            <span className="hidden h-5 w-px bg-[#062B4F]/15 sm:block" aria-hidden="true" />

            <a
              href={`tel:${HELPLINE.replace(/-/g, '')}`}
              className={`flex items-center gap-2 rounded font-semibold text-[#062B4F] transition-colors hover:text-[#F97D09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50 ${hi}`}
            >
              <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>
                {t.helpline}: {HELPLINE}
              </span>
            </a>
          </div>
        </header>

        {/* ═══════════ Main — flex-1 consumes header/footer gap, no push ═══════════ */}
        <main className="flex flex-1 flex-col justify-center gap-6 py-3 lg:min-h-0 lg:grid lg:grid-cols-12 lg:items-center lg:gap-7 lg:overflow-hidden lg:py-4">
          {/* ── Left: identity, pillars, statistics — shifted up as one group (~36px) to prevent bottom clipping ── */}
          <section className="relative flex min-w-0 flex-col lg:col-span-7 lg:min-h-0 lg:-translate-y-9">
            {/* Headline and the aspirational watermark share a row. The watermark
                started out absolutely positioned, which let the headline grow
                straight under it -- both scale with the viewport, so no font size
                fixed it. As a flex sibling it reserves its own width instead. */}
            <div className="flex items-start justify-between gap-6 lg:gap-8">
              <h1 className="min-w-0 text-[clamp(1.95rem,3.2vw,3.25rem)] font-black leading-[1.02] tracking-[-0.025em]">
                <span className="text-[#062B4F]">AAYUSH</span>{' '}
                <span className="text-[#F97D09]">SAARTHI</span>
              </h1>

              <div
                className="hidden w-[132px] flex-shrink-0 select-none flex-col items-end pt-1.5 text-right xl:flex"
                aria-hidden="true"
              >
                <div className="flex flex-col items-end gap-0">
                  {t.watermark.map((w) => (
                    <p key={w} className={`text-[13.5px] leading-[1.4] tracking-[0.01em] text-[#062B4F]/22 ${hi}`}>
                      {w}
                    </p>
                  ))}
                </div>
                <TricolourRule width={88} className="mt-2 opacity-80" />
              </div>
            </div>

            <div
              className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-bold text-[#F97D09] sm:text-[15.5px] ${hi}`}
            >
              {t.pillars.map((p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && (
                    <span className="hidden text-[#062B4F]/20 sm:inline" aria-hidden="true">
                      |
                    </span>
                  )}
                  <span>{p}</span>
                </React.Fragment>
              ))}
            </div>

            <p
              className={`mt-3 max-w-[34rem] text-[14px] leading-[1.55] text-[#062B4F]/90 sm:text-[15.5px] ${hi}`}
            >
              {t.lead}
            </p>

            {/* Figures carried over from the approved reference. There is no
                public pre-auth statistics endpoint, so these stay static
                rather than being wired to an invented API. */}
            <dl className="mt-6 grid grid-cols-2 gap-y-5 gap-x-0 sm:mt-6 sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-[#062B4F]/10 lg:mt-6">
              {t.stats.map((s, i) => {
                const Icon = STAT_ICONS[i];
                return (
                  <div
                    key={s.label}
                    className={`flex flex-col items-start gap-1.5 px-4 first:pl-0 last:pr-0 sm:px-4 lg:px-4 ${
                      i % 2 === 1 ? 'border-l border-[#062B4F]/10 sm:border-l-0' : ''
                    }`}
                  >
                    <Icon
                      className={`h-[26px] w-[26px] shrink-0 lg:h-[27px] lg:w-[27px] ${STAT_TONES[i]}`}
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                    <dd className="min-h-[28px] text-[22px] font-extrabold leading-none text-[#062B4F] sm:text-[26px] lg:text-[27px]">
                      {s.value}
                    </dd>
                    <dt className={`min-h-[18px] text-[13px] leading-none text-[#062B4F]/75 sm:text-[13.5px] ${hi}`}>
                      {s.label}
                    </dt>
                  </div>
                );
              })}
            </dl>

            <div className="mt-6 hidden flex-col items-end self-end text-right lg:flex">
              <p className="font-devanagari text-[18px] font-bold leading-[1.3] text-[#062B4F] lg:text-[19px]">
                स्वस्थ मध्य प्रदेश
                <br />
                समृद्ध मध्य प्रदेश
              </p>
              <TricolourRule width={150} className="mt-2 opacity-90" />
            </div>
          </section>

          {/* ── Right: login card — nudged slightly up to balance with left hero ── */}
          <aside className="min-w-0 self-center lg:col-span-5 lg:min-h-0 lg:-translate-y-2 lg:overflow-visible lg:self-center">
            <div className="mx-auto w-full max-w-[480px] rounded-[18px] border border-[#062B4F]/8 bg-white p-5 shadow-[0_18px_50px_-18px_rgba(6,43,79,0.22)] sm:p-6 lg:max-w-[500px] lg:p-[22px]">
              <div className="flex items-center gap-4 sm:gap-4">
                <span className="flex h-[54px] w-[54px] flex-shrink-0 items-center justify-center rounded-full bg-[#F97D09] sm:h-[60px] sm:w-[60px] lg:h-[62px] lg:w-[62px]">
                  <Users
                    className="h-7 w-7 text-white sm:h-8 sm:w-8"
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0">
                  <h2
                    className={`text-[22px] font-extrabold leading-tight tracking-[-0.015em] text-[#062B4F] sm:text-[26px] lg:text-[28px] ${hi}`}
                  >
                    {t.cardTitle}
                  </h2>
                  <p className={`mt-0.5 text-[13px] text-[#062B4F]/60 sm:text-[14px] ${hi}`}>
                    {t.cardSub}
                  </p>
                </div>
              </div>

              {/* Authentication failure */}
              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div
                      role="alert"
                      className="mt-6 flex items-start gap-2.5 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] p-3.5"
                    >
                      <AlertCircle
                        className="mt-px h-4 w-4 flex-shrink-0 text-[#B91C1C]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className={`text-[13px] font-bold text-[#7F1D1D] ${hi}`}>
                          {t.authFailed}
                        </p>
                        <p className="mt-0.5 break-words text-[12.5px] text-[#991B1B]">{error}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Password-reset / validation notice */}
              <AnimatePresence initial={false}>
                {notice && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div
                      role="status"
                      className={`mt-6 flex items-start gap-2.5 rounded-lg border p-3.5 ${
                        notice.tone === 'info'
                          ? 'border-[#1E8A4F]/25 bg-[#ECFAF1]'
                          : 'border-[#F97D09]/30 bg-[#FFF1E3]'
                      }`}
                    >
                      {notice.tone === 'info' ? (
                        <CheckCircle2
                          className="mt-px h-4 w-4 flex-shrink-0 text-[#17703F]"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertCircle
                          className="mt-px h-4 w-4 flex-shrink-0 text-[#B85903]"
                          aria-hidden="true"
                        />
                      )}
                      <p
                        className={`text-[12.5px] leading-relaxed ${
                          notice.tone === 'info' ? 'text-[#115631]' : 'text-[#8F4502]'
                        } ${hi}`}
                      >
                        {notice.text}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 lg:mt-4 lg:space-y-3.5" noValidate>
                {/* Identifier */}
                <div>
                  <label
                    htmlFor="login-identifier"
                    className={`mb-1.5 block text-[13px] font-bold text-[#062B4F] ${hi}`}
                  >
                    {t.idLabel} <span className="text-[#F97D09]">*</span>
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#062B4F]/35"
                      aria-hidden="true"
                    />
                    <input
                      ref={identifierRef}
                      id="login-identifier"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={t.idPlaceholder}
                      autoComplete="username"
                      required
                      disabled={isLoading}
                      className="h-[46px] w-full rounded-[10px] border border-[#062B4F]/14 bg-[#FBFAF8] pl-12 pr-4 text-[14px] text-[#062B4F] transition-colors placeholder:text-[#062B4F]/35 hover:border-[#062B4F]/25 focus:border-[#F97D09] focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-[#F97D09]/20 disabled:opacity-60 sm:h-[48px] lg:h-[50px]"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label
                    htmlFor="login-password"
                    className={`mb-1.5 block text-[13px] font-bold text-[#062B4F] ${hi}`}
                  >
                    {t.pwLabel} <span className="text-[#F97D09]">*</span>
                  </label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#062B4F]/35"
                      aria-hidden="true"
                    />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.pwPlaceholder}
                      autoComplete="current-password"
                      required
                      disabled={isLoading}
                      className="h-[46px] w-full rounded-[10px] border border-[#062B4F]/14 bg-[#FBFAF8] pl-12 pr-12 text-[14px] text-[#062B4F] transition-colors placeholder:text-[#062B4F]/35 hover:border-[#062B4F]/25 focus:border-[#F97D09] focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-[#F97D09]/20 disabled:opacity-60 sm:h-[48px] lg:h-[50px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t.hidePw : t.showPw}
                      aria-pressed={showPassword}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[#062B4F]/45 transition-colors hover:bg-[#062B4F]/5 hover:text-[#062B4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50"
                    >
                      {showPassword ? (
                        <EyeOff className="h-[18px] w-[18px]" />
                      ) : (
                        <Eye className="h-[18px] w-[18px]" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Options */}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-0.5">
                  <label className="flex cursor-pointer select-none items-center gap-2.5">
                    <span className="relative flex h-[19px] w-[19px] flex-shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={keepSession}
                        onChange={(e) => setKeepSession(e.target.checked)}
                        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-[5px] border border-[#062B4F]/25 bg-white transition-colors checked:border-[#F97D09] checked:bg-[#F97D09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50 focus-visible:ring-offset-1"
                      />
                      <Check
                        className="pointer-events-none relative h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
                        strokeWidth={3.5}
                        aria-hidden="true"
                      />
                    </span>
                    <span className={`text-[14px] text-[#062B4F]/85 ${hi}`}>{t.keepSession}</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleForgot}
                    disabled={resetPending || isLoading}
                    className={`rounded text-[14px] font-semibold text-[#F97D09] transition-colors hover:text-[#B85903] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50 disabled:opacity-55 ${hi}`}
                  >
                    {resetPending ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {t.forgot}
                      </span>
                    ) : (
                      t.forgot
                    )}
                  </button>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className={`flex h-[48px] w-full items-center justify-center gap-3 rounded-[10px] bg-gradient-to-b from-[#FF8D1F] to-[#F97D09] text-[14px] font-bold uppercase tracking-[0.06em] text-white shadow-[0_10px_22px_-10px_rgba(249,125,9,0.85)] transition-all hover:from-[#F97D09] hover:to-[#E86D00] active:from-[#E06E05] active:to-[#C85E02] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#F97D09]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none sm:h-[52px] ${
                    lang === 'hi' ? 'font-devanagari tracking-normal' : ''
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                      <span>{t.submitting}</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-[18px] w-[18px]" aria-hidden="true" />
                      <span>{t.submit}</span>
                      <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>

              {/* OR */}
              <div className="my-3.5 flex items-center gap-4">
                <span className="h-px flex-1 bg-[#062B4F]/10" aria-hidden="true" />
                <span className={`text-[11.5px] font-semibold tracking-[0.03em] text-[#062B4F]/45 ${hi}`}>
                  {t.or}
                </span>
                <span className="h-px flex-1 bg-[#062B4F]/10" aria-hidden="true" />
              </div>

              {/* Authorised personnel notice */}
              <div className="flex items-start gap-3 rounded-[12px] border border-[#062B4F]/8 bg-[#EFF5FD] p-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#1D63C4]">
                  <Shield className="h-5 w-5 text-white" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className={`text-[14px] font-bold text-[#1D63C4] ${hi}`}>{t.authTitle}</p>
                  <p className={`mt-0.5 text-[12.5px] leading-snug text-[#062B4F]/70 ${hi}`}>
                    {t.authBody}
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </main>

        {/* ═══════════ Footer — compact, always in viewport on desktop ═══════════ */}
        <footer className="flex shrink-0 flex-col gap-3 border-t border-[#062B4F]/10 py-3 text-[11.5px] text-[#062B4F]/70 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-3.5 lg:text-[12px]">
          <p className={hi}>{t.copyright}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:gap-x-4">
            {t.links.map((l, i) => (
              <React.Fragment key={l}>
                {i > 0 && (
                  <span className="text-[#062B4F]/20" aria-hidden="true">
                    |
                  </span>
                )}
                <a
                  href="#"
                  className={`rounded transition-colors hover:text-[#F97D09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97D09]/50 ${hi}`}
                >
                  {l}
                </a>
              </React.Fragment>
            ))}
          </div>

          <div className="text-left lg:text-right">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#062B4F]/65">
              VIKSIT
            </p>
            <p className="text-[13px] font-extrabold uppercase text-[#062B4F]">MADHYA PRADESH</p>
            <TricolourRule width={128} className="mt-1" />
          </div>
        </footer>
      </div>
    </div>
  );
};
