interface FooterLink {
  label: string;
  href: string;
}

interface FooterProps {
  links?: FooterLink[];
}

const DEFAULT_LINKS: FooterLink[] = [
  { label: "Privacy Policy", href: "#" },
  { label: "Terms of Service", href: "#" },
];

export default function Footer({ links = DEFAULT_LINKS }: FooterProps) {
  return (
    <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between border-t border-white/5 gap-4">
      <p className="text-xs text-slate-500">&copy; {new Date().getFullYear()} Nano-Bank. All rights reserved.</p>
      <div className="flex gap-6 text-xs text-slate-500">
        {links.map((link) => (
          <a key={link.label} href={link.href} className="hover:text-slate-300 transition-colors">
            {link.label}
          </a>
        ))}
      </div>
    </footer>
  );
}
