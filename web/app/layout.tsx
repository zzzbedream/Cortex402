import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cortex402 — Web3 at the Speed of Experience",
  description:
    "AI-native payment middleware for the x402 protocol on Stellar. " +
    "Trustline-verified, replay-protected, sub-second settlements.",
  openGraph: {
    title: "Cortex402",
    description: "Web3 at the Speed of Experience",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="min-h-screen overflow-x-hidden">{children}</body>
    </html>
  );
}
