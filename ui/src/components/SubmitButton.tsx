interface SubmitButtonProps {
  loading: boolean;
  loadingText: string;
  children: React.ReactNode;
}

export default function SubmitButton({ loading, loadingText, children }: SubmitButtonProps) {
  return (
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
          {loadingText}
        </div>
      ) : (
        children
      )}
    </button>
  );
}
