import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-space-grotesk' });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ibm-plex-sans' });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ibm-plex-mono' });

export const metadata = {
  title: 'EI Dashboard — Extended Interview',
  description: '180-day performance tracker for new joiners. Koenig Solutions HR.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body style={{
        fontFamily: 'var(--font-ibm-plex-sans), system-ui, sans-serif',
      }}>
        <style>{`
          .disp { font-family: var(--font-space-grotesk), sans-serif; }
          .mono { font-family: var(--font-ibm-plex-mono), monospace; }
        `}</style>
        {children}
      </body>
    </html>
  );
}
