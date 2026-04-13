import { Github, ExternalLink } from "lucide-react";

const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { label: "How It Works", href: "#how-it-works" },
      { label: "Features", href: "#features" },
      { label: "Try It Live", href: "#try-it-live" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "GitHub", href: "https://github.com/tu-usuario/cortex402", external: true },
      { label: "Documentation", href: "#how-it-works" },
      { label: "API Reference", href: "#how-it-works" },
    ],
  },
  {
    heading: "Infrastructure",
    links: [
      { label: "VPS Status", href: "#", external: true },
      { label: "Stellar Testnet", href: "https://stellar.expert/explorer/testnet", external: true },
      { label: "Horizon API", href: "https://horizon-testnet.stellar.org", external: true },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div>
            <span className="text-xl font-bold tracking-wider text-white">
              CORTEX<span className="text-brand-400">402</span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-gray-500">
              AI-native payment middleware for the x402 protocol on Stellar.
              Built for the future of machine-to-machine commerce.
            </p>
            <div className="mt-6 flex gap-3">
              <a
                href="https://github.com/tu-usuario/cortex402"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/10 p-2 text-gray-500 transition-colors hover:border-white/20 hover:text-white"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_LINKS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                {col.heading}
              </h4>
              <ul className="mt-4 flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-white"
                    >
                      {link.label}
                      {link.external && (
                        <ExternalLink className="h-3 w-3" />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 border-t border-white/5 pt-8 text-center">
          <p className="text-xs text-gray-600">
            &copy; {new Date().getFullYear()} Cortex402. MIT License. Built for
            the Stellar hackathon.
          </p>
        </div>
      </div>
    </footer>
  );
}
