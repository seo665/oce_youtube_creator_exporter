import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creator CRM",
  description: "Private workspace for managing creator leads.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
