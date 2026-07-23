"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signUpAction } from "@/actions/auth";

export default function SignupForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSin, setShowSin] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await signUpAction(formData);
      if (response.success) {
        toast.success(response.message);
        router.push("/auth/signin");
      } else {
        toast.error(response.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("An unexpected error occurred during signup.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 w-full">
      {/* Name fields in grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="firstName" className="text-xs font-semibold tracking-wide text-slate-300">
            First Name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            placeholder="John"
            autoComplete="given-name"
            className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lastName" className="text-xs font-semibold tracking-wide text-slate-300">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            placeholder="Doe"
            autoComplete="family-name"
            className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-semibold tracking-wide text-slate-300">
          Email Address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="john.doe@example.com"
          autoComplete="email"
          className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500"
        />
      </div>

      {/* Phone Number */}
      <div className="space-y-1.5">
        <label htmlFor="phoneNumber" className="text-xs font-semibold tracking-wide text-slate-300">
          Phone Number
        </label>
        <input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          required
          placeholder="+1 (555) 000-0000"
          autoComplete="mobile-tel"
          className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500"
        />
      </div>

      {/* DOB & SIN Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="dateOfBirth" className="text-xs font-semibold tracking-wide text-slate-300">
            Date of Birth
          </label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            required
            className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm text-slate-300 [color-scheme:dark]"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sin" className="text-xs font-semibold tracking-wide text-slate-300">
            SIN / SSN
          </label>
          <div className="relative">
            <input
              id="sin"
              name="sin"
              type={showSin ? "text" : "password"}
              required
              placeholder="123456789"
              autoComplete="off"
              className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowSin(!showSin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs font-medium focus:outline-none select-none"
            >
              {showSin ? "Hide" : "Show"}
            </button>
          </div>
        </div>
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-semibold tracking-wide text-slate-300">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full px-4 py-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-slate-500 focus:border-nanobank-blue-sky focus:outline-none transition-colors duration-200 text-sm placeholder:text-slate-500 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs font-medium focus:outline-none select-none"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full mt-2 relative group py-3 rounded-lg font-bold text-center text-nanobank-blue-deep bg-gradient-to-r from-nanobank-blue-sky via-nanobank-blue-green to-nanobank-amber-deep bg-[size:200%_auto] hover:bg-right transition-all duration-500 shadow-[0_0_20px_rgba(33,158,188,0.2)] hover:shadow-[0_0_30px_rgba(251,133,0,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0 disabled:hover:translate-y-0"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5 text-nanobank-blue-deep" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Creating Account...
          </div>
        ) : (
          "Sign Up"
        )}
      </button>
    </form>
  );
}
