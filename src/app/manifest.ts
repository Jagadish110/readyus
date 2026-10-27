import type { MetadataRoute } from 'next';

/**
 * Lets people add Localty to their home screen. On iPhone and iPad this is required for browser
 * alerts: Safari only allows them for a site added to the home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Localty',
    short_name: 'Localty',
    description: 'Order from shops near you. Shops: manage orders and deliveries.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fdfbf7',
    theme_color: '#246540',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' }
    ]
  };
}
