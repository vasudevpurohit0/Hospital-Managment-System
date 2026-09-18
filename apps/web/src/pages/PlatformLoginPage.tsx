import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Lock, Mail, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, ArrowLeft } from 'lucide-react';

interface PlatformLoginPageProps {
  onBackToHospitalLogin: () => void;
}

export const PlatformLoginPage: React.FC<PlatformLoginPageProps> = ({ onBackToHospitalLogin }) => {
  const { platformLogin, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 8000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    await platformLogin(email.trim(), password.trim());
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#0B2545] p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#0B2545]/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-[#0B2545]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0B2545]">Platform Console</h1>
            <p className="text-xs text-gray-500">Super Admin sign-in — manages every hospital</p>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="platform-email" className="block text-xs font-bold text-gray-700">
              Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="platform-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="superadmin@platform.local"
                autoComplete="username"
                required
                disabled={isLoading}
                className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="platform-password" className="block text-xs font-bold text-gray-700">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="platform-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                className="w-full h-12 pl-10 pr-11 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0B2545] focus:border-[#0B2545]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !email.trim() || !password.trim()}
            className="w-full h-12 bg-[#0B2545] hover:bg-[#13315C] text-white font-bold text-sm rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <button
          onClick={onBackToHospitalLogin}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0B2545] mx-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to hospital staff sign-in
        </button>
      </div>
    </div>
  );
};
