import './globals.css';

export const metadata = {
  title: 'ShiftOps',
  description: 'Operations management for shift-based teams',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ShiftOps',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
};

export const viewport = {
  themeColor: '#F5F5F7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ShiftOps" />
      </head>
      <body className="antialiased" style={{ background: '#F5F5F7' }}>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(()=>{}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
