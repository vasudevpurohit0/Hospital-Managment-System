import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  ShieldCheck,
  Loader2,
  AlertCircle,
  KeyRound,
  Building2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ═══════════════════════════════════════════════════════════
   ESIC HMS Login Page — Crystal Clear Official Logos
   LEFT PANEL (50%): Deep Navy Blue (#0B2545) + White Emblem & ESIC Badge
   RIGHT PANEL (50%): Crisp White (#FFFFFF) + SSO Login Form
   ═══════════════════════════════════════════════════════════ */

export const LoginPage: React.FC = () => {
  const { login, isLoading, error, clearError } = useAuth();
  const [identifier, setIdentifier] = useState('doctor@esic.gov.in');
  const [password, setPassword] = useState('DoctorPass123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    identifierRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 8000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) return;
    await login(identifier.trim(), password.trim());
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden font-sans select-none bg-white">
      {/* ── Top Tricolor Flag Accent Bar (Spans full width) ── */}
      <div className="h-1.5 w-full flex flex-shrink-0 z-30">
        <div className="h-full w-1/3 bg-[#FF9933]" />
        <div className="h-full w-1/3 bg-white" />
        <div className="h-full w-1/3 bg-[#138808]" />
      </div>

      {/* ── Compact Government Header ── */}
      <header className="flex-shrink-0 z-20 flex w-full border-b border-slate-200">
        {/* Left 50% Header (Navy Blue with Clean ESIC Badge) */}
        <div className="w-1/2 bg-[#0B2545] text-white py-2 px-8 lg:px-12 flex items-center justify-start gap-3.5 border-r border-[#081B34]">
          <div className="bg-white p-1 rounded-md shadow-2xs flex items-center justify-center">
            <img
              src="/esic_logo.png"
              alt="ESIC Official Logo"
              className="h-8 w-auto object-contain"
            />
          </div>
          <div className="border-l border-white/20 pl-3.5 text-left">
            <p className="text-[9px] font-semibold text-amber-300 uppercase tracking-wider">
              Ministry of Labour & Employment • Government of India
            </p>
            <p className="text-[11px] font-bold text-white tracking-tight font-serif">
              Employees&apos; State Insurance Corporation
            </p>
          </div>
        </div>

        {/* Right 50% Header (White) */}
        <div className="w-1/2 bg-white text-slate-900 py-2 px-8 lg:px-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-[#0B2545]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#0B2545]">
              Hospital Single Sign-On
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#0B2545]/5 border border-[#0B2545]/15 rounded px-2.5 py-0.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#B45309]" />
            <span className="text-[10px] font-bold text-[#0B2545]">NIC Gateway Compliant</span>
          </div>
        </div>
      </header>

      {/* ── Main Canvas: True 50% Navy Blue Left / 50% Crisp White Right Partition ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative w-full">
        {/* ════════════════════════════════════════════════════════
           LEFT PANEL: Exactly 50% Width — Deep Navy Blue (#0B2545)
           ════════════════════════════════════════════════════════ */}
        <div className="lg:w-1/2 bg-[#0B2545] text-white p-8 lg:p-14 flex flex-col justify-between items-center relative border-r border-[#081B34] overflow-y-auto">
          {/* Ashoka Emblem Background Watermark (White Opacity ~ 4%) */}
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.04] bg-no-repeat bg-center filter invert"
            style={{
              backgroundImage: `url('/Emblem_of_India.svg')`,
              backgroundSize: '360px',
            }}
          />

          {/* Vertically Centered Left Content */}
          <div className="relative z-10 my-auto pt-6 space-y-8 w-full max-w-[540px]">
            {/* Ashoka Emblem & ESIC Official Logo Pill */}
            <div className="flex items-center gap-5 border-b border-white/10 pb-6">
              <img
                src="/Emblem_of_India.svg"
                alt="Emblem of India"
                className="h-16 w-auto object-contain filter invert"
              />
              <div className="h-12 w-[1px] bg-white/20" />
              <div className="bg-white p-2 rounded-xl shadow-md flex items-center justify-center">
                <img
                  src="/esic_logo.png"
                  alt="ESIC Official Logo"
                  className="h-12 w-auto object-contain"
                />
              </div>
            </div>

            {/* Hero Heading */}
            <div className="space-y-2.5 text-left">
              <h1 className="text-3xl lg:text-4xl font-extrabold text-white font-serif leading-tight">
                Enterprise Hospital Management System
              </h1>
              <p className="text-sm font-semibold text-amber-300">
                Official Digital Healthcare Platform for ESIC Hospitals
              </p>
            </div>

            {/* Four Equal-Sized Statistics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-2 w-full">
              {[
                { label: 'Established 1952', value: '1952' },
                { label: 'ESIC Hospitals', value: '150+' },
                { label: 'Dispensaries', value: '1,600+' },
                { label: 'Beneficiaries', value: '3.4+ Cr' },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="h-[90px] p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm flex flex-col justify-center text-center space-y-1"
                >
                  <p className="text-xl font-extrabold text-white font-serif">{stat.value}</p>
                  <p className="text-[11px] font-medium text-amber-200">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Left Panel Footer Tag */}
          <div className="relative z-10 pt-4 border-t border-white/10 w-full max-w-[540px] flex items-center justify-between text-[11px] text-blue-200/70 font-medium">
            <span>Government of India • Ministry of Labour & Employment</span>
            <span>Established 1952</span>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════
           RIGHT PANEL: Exactly 50% Width — Solid Crisp White (#FFFFFF)
           ════════════════════════════════════════════════════════ */}
        <div className="lg:w-1/2 bg-white p-8 lg:p-14 flex flex-col justify-between items-center overflow-y-auto">
          {/* Vertically & Horizontally Centered Form Container (Width: ~480-500px) */}
          <div className="my-auto py-4 w-full max-w-[480px] space-y-7">
            {/* Form Title & Subtitle */}
            <div className="space-y-1.5 text-left border-b border-slate-100 pb-4">
              <h2 className="text-2xl lg:text-3xl font-bold text-[#0B2545] font-serif tracking-tight">
                Hospital Single Sign-On
              </h2>
              <p className="text-xs text-slate-500 font-medium">Authorized Personnel Login</p>
            </div>

            {/* Error Alert */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                >
                  <div className="p-3.5 rounded bg-red-50 border border-red-200 text-red-800 flex items-start gap-2.5 text-xs w-full">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-red-900">Authentication Failed</p>
                      <p className="text-[11px] mt-0.5 opacity-90">{error}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Official Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5 w-full">
              {/* Username Field */}
              <div className="space-y-1.5 w-full">
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-bold text-slate-700"
                >
                  Government Email / User ID <span className="text-red-600">*</span>
                </label>
                <div className="relative w-full">
                  <User className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    ref={identifierRef}
                    id="login-identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="doctor@esic.gov.in"
                    autoComplete="username"
                    required
                    disabled={isLoading}
                    className="w-full h-14 pl-11 pr-4 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545] transition-all"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1.5 w-full">
                <label htmlFor="login-password" className="block text-xs font-bold text-slate-700">
                  Password <span className="text-red-600">*</span>
                </label>
                <div className="relative w-full">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                    disabled={isLoading}
                    className="w-full h-14 pl-11 pr-11 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center justify-between pt-1 w-full">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-[#0B2545] focus:ring-[#0B2545]"
                  />
                  <span className="text-xs text-slate-600 font-medium">Keep session active</span>
                </label>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#800000] hover:underline"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Secure Login Button (Height: 54px, Government Navy Blue) */}
              <button
                type="submit"
                disabled={isLoading || !identifier.trim() || !password.trim()}
                className="w-full h-[54px] bg-[#0B2545] hover:bg-[#13315C] active:bg-[#081C34] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 border-b-2 border-[#B45309] disabled:opacity-50 mt-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Verifying Security Credentials...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span>Secure Login</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Official Government Footer ── */}
      <footer className="bg-[#0A192F] text-slate-300 py-3 px-8 text-center border-t-2 border-[#B45309] text-xs flex-shrink-0 z-20">
        <div className="w-full flex items-center justify-between text-[11px]">
          <div>
            <p className="font-semibold text-white">
              © Employees&apos; State Insurance Corporation • Government of India
            </p>
          </div>

          <div className="flex items-center gap-4 text-slate-300 text-[11px]">
            <a href="#" className="hover:text-amber-400 transition-colors">
              Privacy Policy
            </a>
            <span>•</span>
            <a href="#" className="hover:text-amber-400 transition-colors">
              Terms of Use
            </a>
            <span>•</span>
            <a href="#" className="hover:text-amber-400 transition-colors">
              Helpdesk: 1800-11-2526
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
