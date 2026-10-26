import { LocationProvider } from '@/lib/state/location';
import { CartProvider } from '@/lib/state/cart';
import { AppHeader } from '@/components/shell/app-header';
import { BottomNav } from '@/components/shell/bottom-nav';
import { CartBar } from '@/components/shell/cart-bar';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocationProvider>
      <CartProvider>
        <div className="paper flex min-h-dvh flex-col">
          <AppHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-40 sm:px-6 md:pb-12">
            {children}
          </main>
          <CartBar />
          <BottomNav />
        </div>
      </CartProvider>
    </LocationProvider>
  );
}
