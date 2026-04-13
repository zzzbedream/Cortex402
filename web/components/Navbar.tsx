"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "Features", href: "#features", active: true },
  { label: "Insights", href: "#how-it-works" },
  { label: "About", href: "#powered-by-stellar" },
  { label: "Case Studies", href: "#", strikethrough: true },
  { label: "Contact", href: "#waitlist" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 z-50 w-full">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <a
          href="/"
          className="text-lg font-medium tracking-tight text-white"
        >
          Cortex<span className="text-brand-400">402</span>
        </a>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 backdrop-blur-xl md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`relative rounded-full px-4 py-1.5 text-sm transition-colors ${
                link.strikethrough
                  ? "text-gray-500 line-through hover:text-gray-400"
                  : link.active
                  ? "text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {link.active && (
                <span className="absolute inset-0 rounded-full border border-white/20 bg-white/10" />
              )}
              <span className="relative">{link.label}</span>
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:block">
          <a
            href="#waitlist"
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-white to-gray-300 px-5 py-2 text-sm font-semibold text-black transition-all hover:shadow-lg hover:shadow-white/10"
          >
            Get Started for Free
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="text-white md:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-white/10 bg-black/90 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1 px-6 py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                  link.strikethrough
                    ? "text-gray-500 line-through"
                    : link.active
                    ? "text-white font-medium"
                    : "text-gray-300"
                }`}
              >
                {link.label}
              </a>
            ))}
            <a
              href="#waitlist"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-white to-gray-300 px-5 py-2.5 text-center text-sm font-semibold text-black"
            >
              Get Started for Free
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
