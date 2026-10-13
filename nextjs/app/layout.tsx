import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Web3Market — Web3 Project Marketplace",
    template: "%s | Web3Market",
  },
  description:
    "Discover and evaluate Web3 projects, AI applications, SaaS products, websites, and digital businesses.",
  metadataBase: new URL("https://web3market.xyz"),
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
