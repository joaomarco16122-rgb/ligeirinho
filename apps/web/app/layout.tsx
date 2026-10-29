import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Ligeirinho | Suas entregas, em movimento', template: '%s | Ligeirinho' },
  description:
    'Conecte seu estabelecimento a entregadores disponíveis. Solicite, acompanhe e confirme suas entregas em um só lugar.',
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
