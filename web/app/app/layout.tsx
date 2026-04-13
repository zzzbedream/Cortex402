import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cortex402 — Dashboard",
  description: "Monitor, simulate, and verify payments on Cortex402.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Dashboard nav */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="/" className="text-lg font-bold tracking-wider text-white">
            CORTEX<span className="text-brand-400">402</span>
            <span className="ml-2 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-400">
              Dashboard
            </span>
          </a>
          <a
            href="/"
            className="text-sm text-gray-400 transition-colors hover:text-white"
          >
            &larr; Back to site
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
