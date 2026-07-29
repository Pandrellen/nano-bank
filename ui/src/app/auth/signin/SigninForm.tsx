"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signInAction } from "@/actions/auth";
import SubmitButton from "@/components/SubmitButton";

const MIN_PASSWORD_LENGTH = 8;

export default function SigninForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await signInAction(formData);
      if (response.success) {
        toast.success(response.message);
        router.push("/dashboard");
      } else {
        toast.error(response.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("An unexpected error occurred during sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 w-full">
      {/* Email */}
      <div className="space-y-2">
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

      {/* Password */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label htmlFor="password" className="text-xs font-semibold tracking-wide text-slate-300">
            Password
          </label>
          {/* Placeholder for a Forgot Password link */}
        </div>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={MIN_PASSWORD_LENGTH}
            title={`Password must be at least ${MIN_PASSWORD_LENGTH} characters`}
            placeholder="••••••••"
            autoComplete="current-password"
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
      <SubmitButton loading={loading} loadingText="Signing In...">
        Sign In
      </SubmitButton>
    </form>
  );
}
