import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "../site-nav.tsx";
import { siteDescription, siteName } from "../site.ts";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "./globals.css";

export const metadata: Metadata = { title: siteName, description: siteDescription };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Read while the page is built, on the server. The browser never sees the variable. */}
        <SiteNav live={process.env.TRAVERSE_BUILD === "server"} />
        {children}
      </body>
    </html>
  );
}
