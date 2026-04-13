"use client";

import { motion } from "framer-motion";
import { Sparkles, Zap, Globe } from "lucide-react";
import VideoBackground from "./VideoBackground";

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.6, ease: "easeOut" as const },
  }),
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

// ---------------------------------------------------------------------------
// Logo placeholder SVGs for marquee
// ---------------------------------------------------------------------------

const LOGOS = [
  { name: "Stellar", path: "M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L20 8.5v7L12 19.82 4 15.5v-7L12 4.18z" },
  { name: "Stripe", path: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" },
  { name: "Vercel", path: "M12 2L1 21h22L12 2z" },
  { name: "AWS", path: "M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 01-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 01-.287-.374 6.18 6.18 0 01-.248-.467c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.296.072-.583.16-.862.272a2.287 2.287 0 01-.28.104.488.488 0 01-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 01.224-.167c.279-.144.614-.264 1.005-.36A4.84 4.84 0 015.1 5.6c.758 0 1.313.172 1.677.519.36.346.543.87.543 1.581v2.082z" },
  { name: "Cloudflare", path: "M16.509 16.516c.14-.507.078-.975-.172-1.313-.226-.312-.598-.497-1.046-.522l-9.15-.117c-.058 0-.109-.033-.136-.083a.166.166 0 01-.001-.159c.027-.05.078-.086.134-.092l9.225-.118c1.003-.052 2.09-.87 2.456-1.852l.463-1.242a.275.275 0 00.014-.132C17.746 7.504 14.674 5 11.043 5 7.833 5 5.089 7.04 4.195 9.886c-.575-.423-1.302-.654-2.082-.571C.967 9.452.095 10.467.007 11.622c-.035.465.066.907.265 1.29C.094 12.954 0 13.128 0 13.328c0 .23.09.45.252.614.164.163.386.256.618.256h15.18c.08 0 .152-.045.19-.114a.217.217 0 00.013-.219l-.744.651z" },
  { name: "GitHub", path: "M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Hero() {
  const HLS_URL =
    "https://stream.mux.com/9JXDljEVWYwWu01PUkAemafDugK89o01BR6zqJ3aS9u00A.m3u8";

  return (
    <section className="relative min-h-screen overflow-hidden bg-black">
      {/* ── Video Background ── */}
      <div className="absolute bottom-[35vh] left-0 right-0 h-[80vh] z-0 pointer-events-none max-md:bottom-[20vh] max-md:h-[60vh]">
        <VideoBackground
          src={HLS_URL}
          className="h-full w-full object-cover"
        />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pt-24 pb-16">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="mx-auto flex max-w-4xl flex-col items-center text-center"
        >
          {/* Badges row */}
          <motion.div
            className="mb-8 flex flex-wrap items-center justify-center gap-3"
            variants={fadeUp}
            custom={0}
          >
            {[
              { icon: <Sparkles className="h-3.5 w-3.5" />, text: "Integrated with Stellar" },
              { icon: <Zap className="h-3.5 w-3.5" />, text: "Sub-second settlements" },
              { icon: <Globe className="h-3.5 w-3.5" />, text: "AI-native x402 protocol" },
            ].map((badge) => (
              <span
                key={badge.text}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-gray-300 backdrop-blur-md"
              >
                {badge.icon}
                {badge.text}
              </span>
            ))}
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={fadeUp}
            custom={1}
            className="text-5xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-[80px]"
          >
            Where Innovation{" "}
            <br className="hidden sm:block" />
            Meets{" "}
            <span className="bg-gradient-to-r from-white via-indigo-300 to-indigo-500 bg-clip-text text-transparent">
              Execution
            </span>
          </motion.h1>

          {/* Subtext */}
          <motion.p
            variants={fadeUp}
            custom={2}
            className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg"
          >
            Automated testing and deployment pipelines built for modern teams.
            <br className="hidden sm:block" />
            Ship faster with confidence &mdash; from commit to production.
          </motion.p>

          {/* CTAs */}
          <motion.div
            variants={fadeUp}
            custom={3}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row"
          >
            <a
              href="#waitlist"
              className="inline-flex items-center justify-center rounded-full border border-white/20 bg-black px-8 py-3.5 text-sm font-semibold text-white transition-all hover:border-white/40 hover:bg-white/5"
            >
              Get Started for Free
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-8 py-3.5 text-sm font-medium text-white backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/10"
            >
              Let&apos;s Get Connected
            </a>
          </motion.div>
        </motion.div>

        {/* ── Logo Marquee ── */}
        <motion.div
          variants={fadeUp}
          custom={5}
          initial="hidden"
          animate="visible"
          className="mt-auto pt-16 w-full max-w-3xl"
        >
          <div className="flex items-center justify-center gap-10 opacity-40">
            {LOGOS.map((logo) => (
              <svg
                key={logo.name}
                viewBox="0 0 24 24"
                className="h-6 w-6 fill-current text-white grayscale"
                aria-label={logo.name}
              >
                <path d={logo.path} />
              </svg>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
