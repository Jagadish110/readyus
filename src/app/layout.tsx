import type { Metadata, Viewport } from 'next';
import { Inter, Bricolage_Grotesque } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap'
});

export const metadata: Metadata = {
  title: {
    default: 'ReadyUs — Shop in Your Radius',
    template: '%s · ReadyUs'
  },
  description:
    'Food, groceries and everyday essentials from approved sellers near you. ReadyUs only shows what can actually reach your door.',
  applicationName: 'ReadyUs',
  appleWebApp: { capable: true, title: 'ReadyUs', statusBarStyle: 'default' }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ff4d1c' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0807' }
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks the document as scripted and applies the stored theme, both
            before paint: no flash, and scroll reveals stay off without JS. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('readyus-theme')||'system';if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){d.dataset.theme='dark'}}catch(e){}})()`
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
